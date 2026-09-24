# SipScore

A mobile-optimised drink rating app for group holidays. Rate wines and cocktails, build your personal top list, and see what the group loves most.

Every holiday is a **trip**: its own ratings, rankings and feed, joined with a
short invite code. The drinks catalogue is shared across trips, so you can rate
the same Mojito again next year and compare.

## Tech Stack

- **Frontend**: Plain HTML, CSS, JavaScript
- **iOS app**: Native SwiftUI client in [`ios/`](ios/README.md)
- **Backend**: Vercel Serverless Functions (Node.js)
- **Database**: Neon PostgreSQL
- **Hosting**: Vercel

## Setup

### 1. Connect to Neon

In your Vercel project settings, add the environment variable:

```
DATABASE_URL=your-neon-connection-string
```

Get this from your Neon console (Settings → Connection string → use the **pooled** connection string).

### 2. Deploy to Vercel

```bash
vercel deploy
```

Or push to GitHub and connect the repo to Vercel for automatic deploys.

### 3. Seed the Database (first deploy only)

After deploying, run this once to create the database tables and load the drinks:

```bash
curl -X POST https://your-app.vercel.app/api/seed
```

This creates the tables and loads all 37 wines + 20 cocktails into the shared
catalogue. Seeding only ever happens once. To stop anyone else calling it, set
`SEED_TOKEN` in the Vercel environment and send it as a header:

```bash
curl -X POST -H "x-seed-token: $SEED_TOKEN" https://your-app.vercel.app/api/seed
```

Upgrading an existing deployment needs no manual step: the first request after
deploy creates the trip tables and folds all existing drinks, ratings and posts
into a trip named **Corfu**, enrolling every existing user. Rename it from the
Trips screen afterwards.

## Development

To run locally with Vercel's dev server (requires Vercel CLI):

```bash
npm install -g vercel
vercel dev
```

Your `DATABASE_URL` must be set (either in `.env.local` or via `vercel env pull`).

### Tests

```bash
npm test
```

The trip integration tests run the real API handlers against a live Postgres —
covering the migration of a pre-trips database, membership enforcement and
cross-trip isolation. They're skipped unless you point them at a server they
may create throwaway databases on:

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
# unix sockets work too:
TEST_DATABASE_URL='postgres://postgres@/postgres?host=/var/run/postgresql&port=5432' npm test
```

`tests/pages.test.js` loads each page's scripts together, the way the browser
does, so two files declaring the same global name is caught before it breaks a
page.

### Browser tests

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:ui
```

`tests/ui/run.js` serves `public/` with the real API handlers behind it (see
`tests/ui/server.js`) and drives headless Chromium through registering,
creating a trip, adding and editing drinks with photos, rating and the feed. It
also screenshots every page in light, OS-dark and toggle-dark on phone and
desktop, and fails if the two dark variants differ or key controls miss WCAG AA
contrast. Screenshots are written to `tests/ui/screenshots/`. It uses
`CHROMIUM_PATH` if set; otherwise run `npx playwright install chromium` once.

### Theme

`public/js/theme.js` runs in every page's `<head>` and always sets
`data-theme` on `<html>` (the stored choice, else the OS setting). The
stylesheet has a single `[data-theme="dark"]` block — don't add
`prefers-color-scheme` media queries, or the in-app toggle and the OS setting
will drift apart again. Use `--on-navy` for text on navy or coloured
surfaces; `--white` is the card *surface* and goes dark.

## Pages

| Page | URL | Description |
|------|-----|-------------|
| Login / Register | `/` | Create a profile with name + 4-digit PIN |
| Trips | `/trips.html` | Create, join by code, and switch between holidays |
| Browse Drinks | `/drinks.html` | Search and filter, scoped to this trip or the whole catalogue |
| Rate a Drink | `/rate.html?id=123` | Give a drink 1–5 stars + tasting notes |
| Rankings | `/leaderboard.html` | Personal top picks & group favourites for the trip |
| Feed | `/feed.html` | The trip's shared feed |
| Add a Drink | `/add-drink.html` | Add a new drink, tagged with the current trip |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth` | Register or login (`action: "register"/"login"`); returns the caller's trips |
| `GET` | `/api/trips` | Your trips (`?user_id=`), one trip (`?id=`), or look up by code (`?code=`) |
| `POST` | `/api/trips` | Create a trip, or join one (`action: "create"/"join"`) |
| `PATCH` | `/api/trips` | Edit trip details (owner only) |
| `DELETE` | `/api/trips` | Leave a trip, or delete it (`action: "leave"/"delete"`) |
| `GET` | `/api/drinks` | List/search drinks (`?search=&category=&type=&user_id=&trip_id=&scope=trip\|all`); lists carry the first photo and a `photo_count` |
| `POST` | `/api/drinks` | Add a new drink, tagged with `trip_id` |
| `GET` | `/api/drink?id=&user_id=` | Drink details + this trip's ratings, plus all-time stats |
| `PATCH` | `/api/drink?id=` | Edit a drink's details and/or photos (`user_id` required; people on the drink's trip, or whoever added it) |
| `POST` | `/api/ratings` | Rate a drink on a trip (upsert on user + drink + trip) |
| `DELETE` | `/api/ratings` | Remove a rating from a trip |
| `GET` | `/api/leaderboard` | Rankings (`?type=personal\|social\|consensus&user_id=&trip_id=`); add `viewer_id` to view someone else's personal board |
| `GET` `POST` `PATCH` `DELETE` | `/api/feed` | The trip's feed, 50 posts a page (`?before_id=` for older) |
| `POST` | `/api/feed-like` | Toggle a like on a post |
| `GET` `POST` `DELETE` | `/api/feed-replies` | Replies to a post |
| `POST` | `/api/feed-reply-like` | Toggle a like on a reply |
| `GET` `PATCH` | `/api/profile` | Read a profile (optionally per trip) or update an avatar |
| `POST` | `/api/seed` | Create schema + seed data (run once; `x-seed-token` if `SEED_TOKEN` is set) |

Omitting `trip_id` from a read gives the all-time view across **the trips you
are on**. Reads need `user_id` (or `viewer_id`) so membership can be checked;
nobody sees ratings, reviews or posts from a trip they aren't part of. The
anonymous catalogue totals on a drink (`overall_*`) stay global.

Photos are stored as data URLs and validated server-side: PNG, JPEG, WebP, GIF
or HEIC base64 only, up to 6 per drink or post. Every route goes through
`withHandler` in `lib/db.js`, which never returns raw database errors.

Drink categories: wine, cocktail, beer, cider, spirit, mocktail, hotdrink
(shown as "Coffee & Tea"), softdrink, milkshake, mead, other. Cider and mead
store their kind (Apple, Traditional…) in `type` and their sweetness in
`style`. The option lists live on the Add/Edit Drink forms, in
`public/js/drinks.js` (filters) and in the iOS `DrinkCategory` enum;
`tests/lists.test.js` fails if they drift apart. Editing a drink whose stored
value is no longer offered keeps that value rather than blanking it.

> The Vercel Hobby plan allows 12 Serverless Functions and the `api/` directory
> is at exactly that. Shared code lives in `lib/`, outside `api/`, so it isn't
> turned into a function — put new helpers there rather than in `api/`.

## Data model

| Table | Notes |
|---|---|
| `users` | Name + salted PIN hash, avatar colour/image |
| `trips` | Name, destination, dates, unique invite code, owner |
| `trip_members` | Who's on a trip, and who owns it |
| `drinks` | Shared catalogue; `trip_id` records the trip a drink was *added on* |
| `ratings` | Unique per (user, drink, **trip**), so a drink can be re-rated next holiday |
| `feed_posts` | Scoped to a trip, with likes and threaded replies |

Deleting a trip cascades its ratings and posts; drinks added on it stay in the
shared catalogue.
