# SipScore — Code Review Fix Spec

Hand-off spec for an implementing agent. Findings were confirmed by running the
real API handlers against a local Postgres 16 (all 17 existing tests pass at
`24fe408`; every P0/P1 API finding below was reproduced with a script, not
inferred from reading).

---

## R — Role

You are a senior full-stack engineer fixing a small Vercel + Neon app (plain
HTML/JS front end, Node serverless handlers in `api/`, shared code in `lib/`).
You ship small, verified, well-tested commits. You do not redesign the product.

## I — Instructions (non-negotiable constraints)

| # | Constraint | Why |
|---|---|---|
| 1 | **Do not add files under `api/`.** | Vercel Hobby caps at 12 functions; `api/` already has 12. New shared code goes in `lib/`; new behaviour piggybacks on existing handlers via query params or body `action`. |
| 2 | Keep the auth model as-is (name + PIN, `user_id` passed in requests). | Product decision. Harden around it (membership checks, validation), don't replace it. |
| 3 | Every schema change goes through `lib/db.js → ensureSchema()` and its `isMigrated()` probe. | The probe short-circuits migrations on warm instances; a new column not in the probe never gets created on existing DBs (see commit `6da2404` for the pattern). |
| 4 | Run `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres npm test` before every push. Use a **TCP** URL (see F9). | Integration tests exercise the real handlers. |
| 5 | Add or extend a test for each P0/P1 fix in `tests/trips.integration.test.js` (or a new `tests/*.test.js`). | Regression protection. |
| 6 | One commit per finding group (P0 security, P1 correctness, P2 efficiency). Clear messages, no model names in commits. | Reviewability. |
| 7 | Never echo raw database errors to the client. `err.message` in a 500 body is a bug. | Leaks schema/constraint names. |

## B — Basic Steps (do in this order)

### Phase 0 — Setup

1. Start Postgres 16 locally (installed at `/usr/lib/postgresql/16/bin`), listening on `127.0.0.1:55432`, trust auth, role `postgres`.
2. `npm install`, then run the suite with `TEST_DATABASE_URL` set. Expect 17/17 passing.
3. Read `lib/db.js` fully, then `api/feed.js`, `api/drinks.js`, `api/drink.js`, `public/js/app.js`, `public/js/feed.js`.

### Phase 1 — P0: security & trip isolation

**F1. Stored XSS via feed post images (server + client).**
- `api/feed.js` POST accepts `image` with **no validation** (repro: `image: '" onerror="alert(1)'` → 201, stored verbatim).
- `public/js/feed.js:172` renders it as `src="${DOMPurify.sanitize(src)}"`. DOMPurify sanitises HTML fragments, not attribute values; a `"` in a text node survives serialisation, so the attribute breaks out. Every trip member who loads the feed executes it.
- Fix (server): add `validateImageField(value, { maxEach: 400_000, maxCount: 6 })` to `lib/db.js` (or a new `lib/validate.js`). Accept `null`, a single data URL, or a JSON array of data URLs. Each must match `^data:image\/(png|jpe?g|webp|gif|heic);base64,[A-Za-z0-9+/=]+$`. Use it in `api/feed.js` POST, `api/drinks.js` POST, `api/drink.js` PATCH, `api/profile.js` PATCH (avatar).
- Fix (client): never interpolate image sources into HTML strings. Build `<img>` with `document.createElement` and set `.src`. Applies to `feed.js` (`renderFeed`, `renderComposeStrip`), `rate.js` (`renderHero`), `add-drink.js` and `edit-drink.js` (`renderPhotoGallery`).
- Add a shared `parsePhotos(imageField)` helper (JSON array | legacy single string → `string[]`, filtered to `data:image/` prefix) in `app.js` and use it everywhere the four copies of that try/catch exist.

**F2. Stored XSS via drink images.**
- `api/drinks.js:94` / `api/drink.js:40` only check `startsWith('data:image/')` and length. Repro: `data:image/png;base64,AAAA" onerror="alert(1)` → 201. `rate.js:128` and `edit-drink.js:238` inject it via innerHTML.
- Fixed by F1's shared validator + DOM-built `<img>`.

**F3. XSS via trip name / user name in the desktop sidebar.**
- `public/js/app.js:435-471` `initSidebar` builds HTML with `${trip.name}` and `${user.name}` unescaped. A trip owner can name a trip `<img src=x onerror=...>` (only length is validated) and it runs for every member on every page.
- Fix: set those two spans with `textContent` after the innerHTML template (as `initTripPill` already does), or add an `escapeHtml()` helper in `app.js` and use it in every template literal that includes server data.

**F4. Trip isolation is opt-in.**
- Membership is only checked `if (tripId && userId)` in `api/feed.js:19`, `api/drink.js:103`, `api/leaderboard.js:19`. Omitting `user_id` skips the check. Repro: `GET /api/feed?trip_id=<other trip>` with no `user_id` → returns that trip's posts.
- The "all-time" views (`trip_id` omitted) span **every** trip, not just the caller's. Repro: non-member `GET /api/feed?user_id=<bob>` → sees posts from a trip Bob is not on.
- `api/feed-like.js`, `api/feed-reply-like.js`, `api/feed-replies.js` (GET and POST) do no membership check at all. Repro: non-member likes and replies on a private trip's post → 200/201.
- `api/ratings.js` DELETE skips membership (POST checks it).
- Fix:
  - `api/feed.js` GET: require `user_id` (400 otherwise). If `trip_id` is given, `requireMembership`. If omitted, restrict to `fp.trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = $viewer)`.
  - `api/drink.js` GET and `api/leaderboard.js` GET: when `trip_id` is given, require `user_id` and membership. When omitted, keep all-time stats but scope the *ratings list* and personal/social/consensus boards to the viewer's trips with the same `IN (SELECT trip_id …)` clause. (Overall aggregate numbers on a shared-catalogue drink may stay global; the README calls that a feature.)
  - Add `requirePostMembership(sql, res, postId, userId)` and `requireReplyMembership(sql, res, replyId, userId)` to `lib/db.js` (join post → trip_members). Call them in `feed-like`, `feed-reply-like`, `feed-replies` GET/POST, and `feed` PATCH/DELETE (ownership already enforced there; membership is belt-and-braces).
  - `api/ratings.js` DELETE: call `requireMembership` like POST does.
  - Update `tests/trips.integration.test.js` "non-members are kept out of a trip" to cover: feed GET without `user_id`, all-time feed as non-member, like/reply as non-member, replies GET as non-member.

### Phase 2 — P1: correctness

**F5. Mead and Other cannot be added or edited.**
- `public/add-drink.html` / `edit-drink.html` offer `mead` and `other`; `api/drinks.js:3` and `api/drink.js:3` reject them (repro: 400 "Invalid category"). `app.js CATEGORY_META` and `drinks.js CATEGORY_TYPES` already know both.
- Fix: single `VALID_CATEGORIES` export in `lib/db.js` including `mead` and `other`; import in both handlers. Add `mead`/`other` chips to `drinks.html`, `leaderboard.html`, `my-reviews.html`, `user-reviews.html` category filters. Add cases to `ios/SipScore/Models/Models.swift DrinkCategory` (label "Mead", "Other").

**F6. Raw Postgres errors returned as 500 bodies.**
- Repro: rating a non-existent drink → `500 {"error":"insert or update on table \"ratings\" violates foreign key…"}`; `style` > 100 chars → `500 {"error":"value too long for type character varying(100)"}`.
- Fix:
  - Server-side length validation before insert/update, matching the schema: drink `name ≤ 200`, `type/varietal/style ≤ 100`, `source ≤ 200`; rating `notes ≤ 1000`; feed content already capped. Return 400 with a human message.
  - Alternatively widen `drinks.style` to `TEXT` (it stores comma-joined tags; 3 tags of 40 chars already overflow) via `ensureSchema` + probe. Recommended: do both (widen `style`, validate the rest).
  - Existence checks that produce 404s: drink on rating POST, post on reply POST / like, reply on reply-like, and `parent_reply_id` must belong to the same `post_id`.
  - Replace every `res.status(500).json({ error: err.message })` with `{ error: 'Server error' }` (keep `console.error(err)`). `api/auth.js` already does this.

**F7. `ensureSchema()` runs outside try/catch in 9 handlers.**
- `drinks.js:15`, `drink.js:21`, `ratings.js:18`, `feed.js:10`, `feed-like.js:17`, `feed-replies.js:10`, `feed-reply-like.js:17`, `leaderboard.js:16`, `profile.js:10`. A DB hiccup becomes an unhandled rejection → Vercel returns a non-JSON 500 → the client's `apiFetch` throws `SyntaxError` instead of a message.
- Fix: add `withHandler(fn, methods)` wrapper in `lib/db.js` that sets CORS + JSON headers, handles OPTIONS, calls `ensureSchema`, invokes `fn(req, res, sql)`, and catches everything into a JSON 500. Wrap all 12 handlers. This also removes 12 copies of the CORS/OPTIONS boilerplate.

**F8. `apiFetch` assumes every response is JSON.**
- `public/js/app.js:145` `await res.json()` throws on HTML error pages (413 payload too large, 504, F7's case).
- Fix: read `res.text()`, try `JSON.parse`, fall back to `{ error: `Request failed (${res.status})` }`. Map 413 to "Photo too large".

**F9. Integration test helper rejects the connection string its own docs recommend.**
- `tests/trips.integration.test.js:9` documents `postgres://postgres@/postgres?host=/tmp&port=55432`; `urlForDatabase()` at line 28 does `new URL('http://postgres@/postgres?…')` → `TypeError: Invalid URL` and all 13 tests fail. Only TCP URLs work.
- Fix: use `pg`'s `ConnectionParameters`/`pg-connection-string` (`parse()`, set `database`, rebuild), or pass `{ ...parse(ADMIN_URL), database: name }` as the `Client` config instead of a string. Update the README/test header to show a TCP example and note the Postgres 16 binary path.

**F10. Owner "leave" refers to a feature that doesn't exist.**
- `api/trips.js:260` returns 409 "Hand ownership over…" but there is no ownership-transfer action; the UI never sends `leave` for an owner.
- Fix (pick one, smallest first): change message to "Delete the trip, or ask another member to create a new one — an owner can't leave." **Or** add `action: 'transfer'` to `PATCH /api/trips` (`new_owner_user_id`, must be a member; set roles atomically with `sql.transaction`) plus a "Make organiser" control in the member list. Spec assumes the message-only fix unless told otherwise.

**F11. Date-only strings are parsed as UTC in the browser.**
- `app.js formatTripDates` and `trips.js isoDate` do `new Date('2026-09-01')` → UTC midnight; users west of UTC see the previous day; `isoDate` round-trips edit forms to the wrong day.
- Fix: `parseDateOnly(str)` that splits `YYYY-MM-DD` and builds a local `Date`; format with `toLocaleDateString`. For `isoDate` return the first 10 chars when the input already matches `^\d{4}-\d{2}-\d{2}`.

**F12. Post edit box built with innerHTML.**
- `feed.js:303` `<textarea>${current}</textarea>` where `current` is the post's `textContent`. `</textarea>` in one's own post breaks out (self-XSS); HTML-looking content also loses formatting on edit.
- Fix: create the textarea with `createElement` and set `.value = post.content` (the raw content from the API, stored on the article via a data map, not the sanitised DOM text).

### Phase 3 — P2: efficiency

**F13. List endpoints ship full-resolution photo sets.**
- `GET /api/drinks` returns `d.image` (up to 6 × ~300 KB base64) for every drink; `drinks.js` uses only the first as a thumbnail. `GET /api/feed` returns up to 100 posts × 6 photos at 1200 px; `feed.js` re-fetches the whole feed after every post/delete. A modest feed is tens of MB per load.
- Fix, in two steps:
  1. Cheap: in `api/drinks.js` return only the first image (`CASE WHEN d.image LIKE '[%' THEN d.image::jsonb->>0 ELSE d.image END AS image`) and a `photo_count`. In `api/feed.js` keep photos but add `?since=<iso>` / `?before=<iso>` so the client can prepend/append instead of reloading; make `submitPost`/`deletePost` update the DOM locally.
  2. Proper: client generates a ~240 px thumbnail alongside each photo at upload (`feed.js resizeFeedPhoto`, `add-drink.js`/`edit-drink.js resizeDrinkPhoto`). Store as `thumbs TEXT` (JSON array) on `feed_posts` and `drinks` via `ensureSchema` (+ probe). Lists return `thumbs`; full photos are fetched on demand via `GET /api/drink?id=&fields=image` and `GET /api/feed?post_id=` (no new function files).
- Add a 4 MB client-side guard on the total payload before POST (Vercel body limit is 4.5 MB) with a friendly toast.

**F14. Feed query cross-joins likes × replies.**
- `api/feed.js:39-41` two LEFT JOINs then `COUNT(DISTINCT …)`; rows scale as likes × replies per post.
- Fix: correlated subqueries or two CTEs (`like_counts`, `reply_counts`) joined by `post_id`; `liked_by_viewer` as `EXISTS (…)`.

**F15. Search race in `drinks.js`.**
- Debounce at 320 ms, but an earlier slow response can land after a later fast one.
- Fix: a request sequence counter (ignore responses whose seq ≠ latest) or `AbortController` on the previous fetch.

**F16. Duplicated code.**
- `tripsForUser` in `api/auth.js` and `api/trips.js` (identical) → `lib/db.js`.
- `VALID_CATEGORIES` ×2, image validation ×2 (F1/F5 already consolidate).
- `initStyleTags`/`getStyleTags` and `resizeDrinkPhoto`/`renderPhotoGallery` duplicated between `add-drink.js` and `edit-drink.js`; `resizeFeedPhoto` is a third copy. Move to `public/js/photos.js` + `public/js/style-tags.js` (or into `app.js`) and include on the three pages.
- `filteredAndSorted`/`reviewCard`/`formatDate` duplicated between `my-reviews.js` and `user-reviews.js` → shared `reviews-common.js`.

**F17. Small query inefficiencies.**
- Like toggles (`feed-like.js`, `feed-reply-like.js`): SELECT → INSERT/DELETE → COUNT (3 round trips, racy). Use `INSERT … ON CONFLICT DO NOTHING RETURNING id`; if 0 rows, `DELETE`. Then one COUNT (2 round trips, no race).
- `api/seed.js`: 57 single-row inserts → one multi-row `INSERT` for wines and one for cocktails.
- `api/trips.js` POST/PATCH: `tripsForUser(...).filter(t => t.id === id)` fetches all trips to return one; add `tripForUser(sql, userId, tripId)` (same SELECT with `AND t.id = $3`).
- `api/trips.js` create: trip INSERT + membership INSERT aren't atomic → orphan trip on failure. Use `sql.transaction([...])` from `@neondatabase/serverless` (the test shim needs a matching `transaction` method; see `tests/helpers/neon-shim.js`).
- `api/leaderboard.js:91` `HAVING COUNT(r.id) > 0` is redundant with the INNER JOIN.

**F18. Theme flash.**
- `app.js` applies `data-theme` on load, but every page includes it at the end of `<body>`. Move the 3-line IIFE inline into each page's `<head>` (before the stylesheet).

**F19. Dead code and leaks.**
- `app.js showCropModal` adds `document` `mousemove`/`mouseup` listeners per open and never removes them → remove on close.
- `App.refreshTrip` is unused (delete or wire into page load so renamed trips show up); `renderStars(avg, size)` `size` unused; `edit-drink.js` uses `window._loadedPhotos` as a global → module-level `let`.
- `public/js/*` top-level `throw new Error('Not authenticated')` in `feed.js` after the redirect → `return`-style guard (wrap page in an init function like the other pages).

### Phase 4 — P3: hardening (do only if time allows; confirm with owner first)

- `api/auth.js:97` PIN compare with `!==` → `crypto.timingSafeEqual` on buffers. Add a per-name failed-attempt counter (`users.failed_attempts`, `locked_until`) — 4-digit PINs are brute-forceable otherwise.
- `users.name` UNIQUE is case-sensitive while the register check is case-insensitive; add `CREATE UNIQUE INDEX IF NOT EXISTS users_name_lower_key ON users (LOWER(name))` via `ensureSchema`, and handle the 23505 error as 409.
- `api/seed.js` is unauthenticated; require a `SEED_TOKEN` env header once set.
- `api/drink.js` PATCH (metadata) has no `user_id` at all; image PATCH requires `user_id` but ignores it. Require `user_id` and membership of the drink's `trip_id` **or** `added_by_user_id === user_id`; document that seeded drinks are editable by any signed-in user.
- `api/leaderboard.js:45` personal board `GROUP BY` lacks `r.id`; two identical ratings of one drink on different trips collapse in the all-time view. Add `r.id`.
- `lib/db.js ensureSchema` on concurrent cold starts can race (`CREATE TABLE IF NOT EXISTS` duplicate-key panics). Wrap the migration in `pg_advisory_lock(hashtext('sipscore_schema'))` … `pg_advisory_unlock`.
- `backfillLegacyTrip` re-assigns every `trip_id IS NULL` drink to the oldest trip whenever the probe reports "not migrated". Guard it so it only runs when `ratings.trip_id` was just added (i.e. a real legacy DB), not on a probe false-negative.

## E — End Goal

| Outcome | Acceptance check |
|---|---|
| No stored XSS vector via images, trip names or user names | New tests: image validator rejects `"`/non-base64; front-end never interpolates server strings into `innerHTML`; grep for `` src="${ `` returns nothing in `public/js` |
| Trip data is only visible to members | Integration test: non-member gets 403 on feed/likes/replies; all-time views only include the caller's trips |
| Every category in the UI is accepted by the API | Test: POST `mead` and `other` → 201 |
| No raw DB error ever reaches a client | grep `err.message` in `api/` returns nothing; tests assert 400/404 for missing drink/post and over-long fields |
| Suite runs from the documented command | `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres npm test` → all green, new tests included |
| List payloads no longer carry full photo sets | Manual: `/api/drinks` response has one image per drink; feed post/delete doesn't refetch the list |

## N — Narrowing (out of scope)

- No auth redesign (sessions, JWTs, passwords).
- No move of images to Blob storage in this pass (note it as the follow-on to F13 step 2).
- No CSS work; `style.css` was not reviewed.
- No iOS changes beyond adding `mead`/`other` to `DrinkCategory`; the iOS client sends no images, so F1/F2 do not affect it.
- Do not change the consensus formula (`(5·μ + Σstars)/(5 + n)` is a sane Bayesian prior).

## A — Ask (questions for the owner before Phase 4)

1. F10: message-only fix, or implement ownership transfer?
2. F4: should "all-time" (no `trip_id`) views be **caller's trips only** (recommended) or remain global for drink aggregates?
3. F13 step 2 adds two `TEXT` columns and a migration. Acceptable now, or ship step 1 only?
4. P3 rate-limiting changes the login UX (lockout message). Wanted?

---

## Appendix A — Repro evidence (local Postgres 16, handlers called via `tests/helpers/neon-shim.js`)

| Probe | Result |
|---|---|
| `POST /api/drinks` category `mead` | `400 Invalid category` |
| `POST /api/feed` with `image: '" onerror="alert(1)'` | `201`; stored verbatim; returned by `GET /api/feed` |
| `POST /api/drinks` image `data:image/png;base64,AAAA" onerror="alert(1)` | `201` |
| `GET /api/feed?trip_id=T` (no `user_id`) as non-member | `200`, posts returned |
| `GET /api/feed?user_id=<non-member>` (no `trip_id`) | `200`, other trip's posts returned |
| `POST /api/feed-like` as non-member | `{ liked: true, like_count: 1 }` |
| `POST /api/feed-replies` as non-member | `201` |
| `POST /api/ratings` drink_id 999999 | `500 insert or update on table "ratings" violates foreign key constraint…` |
| `POST /api/drinks` style 120 chars | `500 value too long for type character varying(100)` |
| `DELETE /api/trips action=leave` as owner of a 2-member trip | `409 Hand ownership over or delete the trip before leaving…` |
| `npm test` with `postgres://postgres@/postgres?host=…` | 13 × `TypeError: Invalid URL` |
| `npm test` with `postgres://postgres@127.0.0.1:55432/postgres` | 17/17 pass |

## Appendix B — File map

| Area | Files |
|---|---|
| Shared server | `lib/db.js` |
| Handlers (12, cap reached) | `api/auth.js` `trips.js` `drinks.js` `drink.js` `ratings.js` `leaderboard.js` `feed.js` `feed-like.js` `feed-replies.js` `feed-reply-like.js` `profile.js` `seed.js` |
| Front end | `public/js/app.js` (shared), `feed.js`, `rate.js`, `drinks.js`, `trips.js`, `leaderboard.js`, `add-drink.js`, `edit-drink.js`, `my-reviews.js`, `user-reviews.js`; pages in `public/*.html` |
| Tests | `tests/rate.test.js` (unit, vm sandbox), `tests/trips.integration.test.js` (real Postgres), `tests/helpers/neon-shim.js` |
| iOS | `ios/SipScore/Models/Models.swift` (`DrinkCategory`) |

---

## Status — implemented

Everything above was implemented on this branch, with these decisions:

| Open question | Decision |
|---|---|
| F10 owner leaving | Message-only: "The organiser can’t leave a trip others are on. Delete the trip instead." No ownership transfer. |
| F4 all-time views | Scoped to the caller's trips. Anonymous `overall_*` catalogue totals on a drink stay global. |
| F13 photo payloads | Step 1 only: lists ship one thumbnail + `photo_count`; the feed pages by 50 and updates the DOM locally. No new thumbnail columns. |
| P3 rate limiting | Not done: no PIN lockout. PIN comparison is now constant-time and names are unique case-insensitively in the database. |

Deviations from the spec:
- **Advisory lock (P3):** the Neon HTTP driver can't hold a session lock across statements, so concurrent migrations instead retry once on a duplicate-object error.
- **Feed PATCH/DELETE:** ownership only, no membership check, so people can still tidy up their own posts after leaving a trip.
- **`--white` kept as the surface token**, with a new `--on-navy` for text on navy (rather than renaming every `--white` to `--surface`).
- **Extra fixes found while verifying:** a later schema change could fold seeded catalogue drinks into a phantom "Corfu" trip; the backfill now only runs for genuinely legacy data. Edit Details on a trip opened a blank New Trip form. On desktop the sticky compose box and filter bars covered content because they still reserved the hidden header's height. Cider's Sweetness list contained Rosé and Sparkling. PIN digits were invisible in dark mode. Mead/Other had no badge colours. Pages depended on DOMPurify from a CDN.

Verification: `npm test` (unit, page-script and integration tests on Postgres 16) and `npm run test:ui` (browser flows, injection checks, dark-mode parity and contrast).
