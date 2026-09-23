# UI Review — Add Drink page and Dark Mode

Companion to `code-review-fix-spec.md`. Findings were produced by rendering the
real pages in headless Chromium (390×844 @2x and 1280×860) with mocked API data,
in three theme states:

| State | How it arises | Mechanism |
|---|---|---|
| **light** | Default | `:root` tokens |
| **os-dark** | Device prefers dark, no toggle pressed | `@media (prefers-color-scheme: dark)` blocks |
| **toggle-dark** | Device is light, user pressed the moon button | `[data-theme="dark"]` token block only |

Contrast ratios below are WCAG 2.x (AA needs 4.5:1 for text, 3:1 for large text and UI).

---

## A. Add Drink page (`public/add-drink.html`, `add-drink.js`)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| A1 | **P0** | **Selected photos render unstyled.** `renderPhotoGallery()` emits `.photo-gallery`, `.photo-gallery-thumb`, `.photo-gallery-remove` but `style.css` has **zero** rules for any of them. Each photo renders at natural width (overflowing the card), stacked vertically, with a bare `×` button floating below it. Same code and same result on Edit Drink. | Screenshot `add-drink_state2-*`; `grep -c photo-gallery style.css` → 0 |
| A2 | **P0** | **Active category button and active style tags are unreadable in dark mode (both variants).** `.category-btn.active` and `.style-tag.active` use `color: var(--white)` on `background: var(--navy)`. In dark, `--white` becomes `#1c2840` and `--navy` becomes `#0f1929`. | Contrast **1.20:1** (light mode: 14.8:1). Screenshots `add-drink_html-phone-osdark`, `-toggledark` |
| A3 | P1 | Mead and Other are offered here but rejected by the API (spec F5). The user fills the whole form, presses Add, and gets "Invalid category". | Spec F5 repro |
| A4 | P1 | Server error copy leaks internals: "Name, category, and user_id are required" is shown verbatim under the form. | `api/drinks.js:76` |
| A5 | P2 | No cap feedback on photos: after 6, the "Add photos" button remains (the `.has-photo` CSS class exists but is never applied) and the only feedback is a toast. Show "6 / 6" in the label and disable the picker. | `add-drink.js:164` |
| A6 | P2 | Photos block has `margin-bottom: 4px` while every other `.form-group` has 16px, so "Add photos" sits tight against the next label. | `.photo-picker { margin-bottom: 4px }` |
| A7 | P2 | Category grid is 3 columns at every width: 11 items leave an orphan 2-item row, and "Hot Drink" / "Soft Drink" wrap to two lines at 390px making row 3 taller than the others. Use 2 columns below 400px, 4 columns ≥ 600px, and `white-space: nowrap`. | Screenshot `add-drink_html-phone-light` |
| A8 | P2 | Category buttons and style tags are `<button>`s with only a class toggle; no `aria-pressed`. Screen readers cannot tell what is selected. Same for `.chip` and `.scope-btn` elsewhere. | Markup |
| A9 | P2 | Placeholder text contrast is low in both themes (light `#aaa` on ivory **2.19:1**; dark `#4a5a70` on `#131c2e` **2.42:1**). Raise to ≥ 3:1. | Token `--placeholder` |
| A10 | P3 | Client `maxlength` values don't match the schema (name 150 vs 200; source 100 vs 200) and there is no server check (spec F6). Align to one source of truth. | Markup vs `lib/db.js` |
| A11 | P3 | `resizeDrinkPhoto`, `renderPhotoGallery`, `initStyleTags`, `getStyleTags`, `FIELD_MAP`, `ALL_CATEGORIES` are duplicated verbatim in `edit-drink.js` (spec F16). | Diff of the two files |

## B. Edit Drink page (found while testing A1)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| B1 | **P0** | **Save Changes never works.** `edit-drink.html` has no `#editError` element, but `handleEdit()` does `document.getElementById('editError').textContent = ''` after disabling the button → `TypeError`, button stuck on "Saving…", **no PATCH request is sent**. `setCategory()` throws the same error on every category click (UI still updates because the throw is last). | Playwright run: `errs: ["Cannot set properties of null…" ×2]`, `btn: {text:"Saving…", disabled:true}`, `apiCalls: ["GET /api/drink"]` only |
| B2 | P2 | Save button is jammed against the last input: the form has no error/spacer element and the last `.form-group` has `margin-bottom: 0`. | Screenshot `edit-drink_html_id_1-phone-osdark` |

## C. Dark mode

### C1. Root cause: three diverging definitions and an overloaded token

- Dark tokens are declared twice (`@media … :root:not([data-theme="light"])` at `style.css:3027` and `[data-theme="dark"]` at `:3057`) and must be kept in sync by hand.
- **Every component-level dark override (`style.css:3105-3175`) lives inside `@media (prefers-color-scheme: dark)`.** The `[data-theme="dark"] .x` selectors in that block are dead code on a light-OS device, because the media query never matches. So pressing the moon button on a light device gives dark tokens but light-mode components.
- `--white` means both "card surface" and "text on navy". In dark mode the surface goes to `#1c2840`, so everything that used `--white` as a text colour on a navy background disappears. That is why A2 fails in **both** dark variants.

Measured pixel difference between os-dark and toggle-dark, same page and data:

| Page | Differing pixels |
|---|---|
| Drinks | 2.80% |
| Feed | 0.74% |
| Leaderboard | 0.72% |
| Edit Drink | 0.31% |
| Rate | 0.14% |
| Add Drink, Trips list, Login | 0.00% |

### C2. Broken in **both** dark variants (no override exists at all)

| # | Sev | Element | Contrast | Where |
|---|---|---|---|---|
| C2a | **P0** | Active category button / active style tag text | 1.20:1 | Add Drink, Edit Drink |
| C2b | **P0** | **Invite code** (`.invite-code`, `color: var(--navy)` on `--gold-pale`) — the one thing a user must read out loud on holiday | ~1.5:1 | Trip detail modal |
| C2c | P2 | Placeholder text | 2.42:1 | All forms |

### C3. Broken only in **toggle-dark** (override exists but is trapped in the media query)

| # | Sev | Element | Symptom | Where |
|---|---|---|---|---|
| C3a | **P0** | `.scope-btn.active` ("This trip") | Invisible label | Drinks |
| C3b | **P0** | `.chip.active` ("All") | Invisible label | Drinks, Rankings, My Reviews |
| C3c | **P0** | `.btn-primary` ("Post", "Reply", "Save", "Join Trip") | Invisible label | Feed, Trips |
| C3d | P1 | `.drink-hero-title` | Title nearly invisible on the navy hero | Rate |
| C3e | P1 | All `.badge-*` category badges | Light-mode pastel pills on dark cards | Drinks, Rankings |
| C3f | P2 | `.rank-2`, `.rank-3`, `.btn-danger`, `.form-error`, `.login-page` | Light-mode colours | Rankings, modals, Login |
| C3g | P2 | `color-scheme: dark` not applied | Native `<select>` dropdowns and date pickers render light | Every form |

### C4. Other

| # | Sev | Finding |
|---|---|---|
| C4a | P1 | **Literal `\n` rendered on the Rate page.** `public/rate.html:21` contains the two characters `\n` in the markup after the hero comment; it renders as visible text top-left in every theme. |
| C4b | P2 | `.rank-2` in light mode is white on `#b0b8c4` → **2.0:1**. |
| C4c | P2 | Theme flash on load: the theme IIFE lives in `app.js`, which every page loads at the end of `<body>` (spec F18). |
| C4d | P3 | `<meta name="theme-color">` is fixed at `#1a2744`; in dark the header is `#0f1929`, so the iOS status bar band doesn't match. Add a second tag with `media="(prefers-color-scheme: dark)"` or set it from JS alongside `data-theme`. |

---

## D. Fix spec (append to Phase 1/2 of `code-review-fix-spec.md`)

### D1. Dark mode architecture (fixes C1, C2, C3 in one pass)

1. **Resolve the theme in JS, once, in `<head>`.** Inline (not in `app.js`) on every page:
   ```html
   <script>
     (function(){var s=localStorage.getItem('sipscore-theme');
       var d=s||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
       document.documentElement.setAttribute('data-theme',d);})();
   </script>
   ```
   In `app.js`, when no stored preference exists, listen to `matchMedia(...).addEventListener('change', …)` and update `data-theme`. `toggleTheme()` keeps writing the stored value.
2. **Delete both `@media (prefers-color-scheme: dark)` blocks** in `style.css`. Keep a single `[data-theme="dark"] { …tokens… }` block and move every component override (`:3105-3175`) to plain `[data-theme="dark"] .x` selectors outside any media query. Also delete the `[data-theme="light"]` block (it just restates `:root`).
3. **Split the overloaded token.** Add to `:root` and `[data-theme="dark"]`:
   - `--surface` (card background: `#fff` / `#1c2840`) — replace `background: var(--white)` with it on cards, inputs, chips, tags, buttons.
   - `--on-navy` (text on navy surfaces: `#fff` / `#e8eaf0`) — use it in `.category-btn.active`, `.style-tag.active`, `.btn-primary`, `.chip.active`, `.scope-btn.active`, `.rank-2`, `.rank-3`, `.drink-hero-title`, `.photo-picker-preview-remove`, `.user-avatar`, `.app-logo span`.
   - `--code-text` (`--navy` / `#e8d5b0`) for `.invite-code`.
   After this, most of the hand-written component overrides in `:3105-3175` become unnecessary; keep only the badge palette.
4. `[data-theme="dark"] { color-scheme: dark; }` on the root, not on `body`, so native controls follow.
5. Raise `--placeholder` to `#8a8478` (light) and `#6b7d96` (dark) for ≥ 3:1.
6. Fix `.rank-2` light: `color: var(--navy)`.
7. `theme-color`: emit two meta tags with `media` attributes, or set it in the head script.
8. Acceptance: re-run the screenshot harness (see E) and require the os-dark vs toggle-dark pixel diff to be 0.00% on every page; spot-check A2, C2b, C3a–c by eye.

### D2. Add Drink / Edit Drink

1. **A1** — add CSS:
   ```css
   .photo-gallery { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:10px; }
   .photo-gallery:empty { display:none; }
   .photo-gallery-thumb { position:relative; aspect-ratio:1; border-radius:var(--radius-sm); overflow:hidden; background:var(--navy-light); border:1px solid var(--border); }
   .photo-gallery-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
   .photo-gallery-remove { position:absolute; top:6px; right:6px; width:28px; height:28px; border-radius:50%; border:none; background:rgba(15,25,41,.72); color:#fff; font-size:1rem; line-height:1; display:flex; align-items:center; justify-content:center; cursor:pointer; backdrop-filter:blur(4px); }
   ```
   Build thumbnails with `createElement` and `.src` (spec F1), not innerHTML.
2. **B1** — add `<div class="form-error" id="editError"></div>` above the Save button in `edit-drink.html` (also fixes B2), and make `setCategory()`/`handleEdit()` null-safe on the error element. Add a Playwright smoke test (E) that presses Save and asserts a PATCH is sent.
3. **A5** — label reads `Photos (n / 6)`; when `n === 6` add `disabled` to the file input and `.has-photo` (rename to `.is-full`) to hide the picker.
4. **A6** — `.photo-picker { margin-bottom: 16px }` (or drop the rule).
5. **A7** — `.category-grid { grid-template-columns: repeat(2,1fr) } @media (min-width:400px){ 3 } @media (min-width:600px){ 4 }`; `.category-btn { white-space: nowrap; }`.
6. **A8** — set `aria-pressed="true|false"` in `setCategory()`, the tag toggles, `renderScopeToggle()` and chip handlers.
7. **A4** — user-facing messages only from the server (spec F6); the client shows "Please pick a category" before posting.
8. **C4a** — delete the `\n` at `rate.html:21`.

### E. Screenshot harness (keep it)

The review used a ~90-line `playwright-core` script: static-serve `public/`, seed `localStorage` (`sipscore_user`, `sipscore_trip`, optional `sipscore-theme`), stub `**/api/**` with fixtures, block Google Fonts, and screenshot every page for `{light, os-dark, toggle-dark} × {390×844@2x, 1280×860}`. Add it as `tests/ui/screenshots.js` with an `npm run shots` script, and a `pixelmatch` step that fails when os-dark ≠ toggle-dark. Chromium is at `/opt/pw-browsers/chromium` in this environment; elsewhere `npx playwright install chromium`.
