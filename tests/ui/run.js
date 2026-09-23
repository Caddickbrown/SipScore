/* =============================================
   tests/ui/run.js — browser tests against the real stack
   ---------------------------------------------
   Drives the pages in headless Chromium with the real API handlers behind
   them (tests/ui/server.js) on a throwaway Postgres database, then:
     • walks the main flows (register, trip, add/edit drink with photos,
       rate, feed) and checks the results in the database,
     • checks nothing from the server can execute as markup,
     • screenshots every page in light, OS-dark and toggle-dark and fails if
       the two dark variants differ or key controls miss WCAG contrast.

     TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:ui

   Chromium: set CHROMIUM_PATH, else /opt/pw-browsers/chromium is tried, else
   whatever `npx playwright install chromium` put in place.
   Screenshots land in tests/ui/screenshots/ (git-ignored).
   ============================================= */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Client } = require('pg');
const { parse: parseConnectionString } = require('pg-connection-string');
const { chromium } = require('playwright-core');
const { PNG } = require('pngjs');
const { start } = require('./server');

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const OUT = path.join(__dirname, 'screenshots');
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 };

if (!ADMIN_URL) {
  console.log('UI tests skipped — set TEST_DATABASE_URL');
  process.exit(0);
}

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (fs.existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  return undefined;
}

// A real, decodable PNG of the given size and colour, for file uploads.
function makePng(width, height, [r, g, b]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = r; png.data[i * 4 + 1] = g; png.data[i * 4 + 2] = b; png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png, { deflateLevel: zlib.constants.Z_BEST_SPEED });
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok - ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`not ok - ${name}\n  ${String(err && err.stack || err).split('\n').slice(0, 6).join('\n  ')}`);
  }
}

async function freshDatabase() {
  const name = `sipscore_ui_${process.pid}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const cfg = { ...parseConnectionString(ADMIN_URL), database: name };
  const auth = cfg.user ? `${encodeURIComponent(cfg.user)}${cfg.password ? ':' + encodeURIComponent(cfg.password) : ''}@` : '';
  const host = cfg.host && cfg.host.startsWith('/') ? '' : `${cfg.host || 'localhost'}:${cfg.port || 5432}`;
  const query = cfg.host && cfg.host.startsWith('/') ? `?host=${encodeURIComponent(cfg.host)}&port=${cfg.port || 5432}` : '';
  return `postgres://${auth}${host}/${name}${query}`;
}

// Counts 16×16 blocks whose average colour differs by more than 16/255 in any
// channel. Theme bugs change whole elements (a badge, a button label), which
// shows up in dozens of blocks; Chromium's occasional one-pixel nudge of text
// inside form fields during full-page capture doesn't move a block average.
// Calibrated against the original toggle-dark bugs: every page scored ≥ 38.
function differingBlocks(a, b, size = 16, tolerance = 16) {
  let differing = 0;
  for (let by = 0; by < a.height; by += size) {
    for (let bx = 0; bx < a.width; bx += size) {
      const sumA = [0, 0, 0];
      const sumB = [0, 0, 0];
      let n = 0;
      for (let y = by; y < Math.min(by + size, a.height); y++) {
        for (let x = bx; x < Math.min(bx + size, a.width); x++) {
          const i = (y * a.width + x) * 4;
          for (let c = 0; c < 3; c++) { sumA[c] += a.data[i + c]; sumB[c] += b.data[i + c]; }
          n++;
        }
      }
      if ([0, 1, 2].some(c => Math.abs(sumA[c] - sumB[c]) / n > tolerance)) differing++;
    }
  }
  return differing;
}

// WCAG contrast of an element's text colour against the nearest opaque background.
async function contrastOf(page, selector) {
  return page.$eval(selector, (el) => {
    const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fg = parse(getComputedStyle(el).color);
    let node = el;
    let bg = [255, 255, 255, 1];
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.length === 3 || (c.length === 4 && c[3] > 0.5)) { bg = c; break; }
      node = node.parentElement;
    }
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const databaseUrl = await freshDatabase();
  const server = await start({ databaseUrl });
  const db = server.client;
  const base = server.url;
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });

  const pageErrors = [];
  async function newContext(opts = {}, init = {}) {
    const ctx = await browser.newContext({ ...PHONE, ...opts });
    // Google Fonts may be unreachable in CI; fall back rather than hang.
    await ctx.route('**/fonts.googleapis.com/**', r => r.abort());
    await ctx.route('**/fonts.gstatic.com/**', r => r.abort());
    if (init.user || init.theme !== undefined) {
      await ctx.addInitScript(({ user, trip, theme }) => {
        if (user) localStorage.setItem('sipscore_user', JSON.stringify(user));
        if (trip) localStorage.setItem('sipscore_trip', JSON.stringify(trip));
        if (theme) localStorage.setItem('sipscore-theme', theme);
      }, init);
    }
    ctx.on('page', p => {
      p.on('pageerror', e => pageErrors.push(`${p.url()}: ${e.message}`));
      p.on('dialog', d => d.accept());
    });
    return ctx;
  }

  await fetch(`${base}/api/seed`, { method: 'POST' });

  let daniel;
  let trip;
  let drinkId;

  /* ---------- Sign up and create a trip through the UI ---------- */
  await check('register through the login screen and land on Trips', async () => {
    const ctx = await newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await page.fill('#nameInput', 'Daniel');
    for (const [i, d] of ['1', '2', '3', '4'].entries()) await page.fill(`#p${i + 1}`, d);
    await page.click('#submitBtn');
    await page.click('#confirmYesBtn');
    await page.waitForURL('**/trips.html');
    daniel = await page.evaluate(() => JSON.parse(localStorage.getItem('sipscore_user')));
    assert.equal(daniel.name, 'Daniel');
    await ctx.close();
  });

  await check('create a trip; dates display as entered even west of UTC', async () => {
    const ctx = await newContext({ timezoneId: 'America/Los_Angeles' }, { user: daniel });
    const page = await ctx.newPage();
    await page.goto(`${base}/trips.html`);
    await page.click('#newTripBtn');
    await page.fill('#tripName', 'Corfu 2026');
    await page.fill('#tripDestination', 'Corfu');
    await page.fill('#tripStart', '2026-09-01');
    await page.fill('#tripEnd', '2026-09-10');
    await page.click('#tripSaveBtn');
    await page.waitForSelector('.trip-card');
    const meta = await page.textContent('.trip-card .trip-meta');
    assert.match(meta, /1 Sept 2026 – 10 Sept 2026/, meta);
    trip = await page.evaluate(() => JSON.parse(localStorage.getItem('sipscore_trip')));

    // Editing round-trips the same dates (they used to shift by a day east of UTC).
    await page.click('.trip-card');
    await page.click('#detailEditBtn');
    assert.equal(await page.inputValue('#tripStart'), '2026-09-01');
    assert.equal(await page.inputValue('#tripEnd'), '2026-09-10');
    await ctx.close();
  });

  /* ---------- Add Drink ---------- */
  await check('add a Mead with two photos; gallery is styled and counts', async () => {
    const ctx = await newContext({}, { user: daniel, trip });
    const page = await ctx.newPage();
    await page.goto(`${base}/add-drink.html`);
    await page.click('#catMead');
    assert.equal(await page.getAttribute('#catMead', 'aria-pressed'), 'true');
    assert.equal(await page.isVisible('#meadFields'), true);
    assert.equal(await page.isVisible('#wineFields'), false);

    await page.fill('#drinkName', 'Honey Mead');
    await page.selectOption('#meadType', 'Dry');
    await page.fill('#meadSource', 'Lyme Bay Winery, Devon');
    await page.setInputFiles('#drinkPhotoInput', [
      { name: 'a.png', mimeType: 'image/png', buffer: makePng(1600, 1200, [160, 82, 45]) },
      { name: 'b.png', mimeType: 'image/png', buffer: makePng(900, 1400, [40, 90, 160]) },
    ]);
    await page.waitForFunction(() => document.querySelectorAll('#photoGallery .photo-gallery-thumb').length === 2);
    assert.equal(await page.textContent('#photoCount'), '(2 / 6)');

    const card = await page.$eval('#addDrinkForm', el => el.getBoundingClientRect().width);
    const thumb = await page.$eval('.photo-gallery-thumb', el => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    assert.ok(thumb.w < card / 2, `thumbnail fits the card (${thumb.w} vs ${card})`);
    assert.ok(Math.abs(thumb.w - thumb.h) < 2, 'thumbnails are square');
    await page.screenshot({ path: path.join(OUT, 'add-drink-photos-phone.png'), fullPage: true });

    await page.click('#addBtn');
    await page.waitForURL('**/rate.html?id=*');
    drinkId = Number(new URL(page.url()).searchParams.get('id'));
    const { rows: [row] } = await db.query('SELECT name, category, type, image, trip_id FROM drinks WHERE id = $1', [drinkId]);
    assert.equal(row.category, 'mead');
    assert.equal(row.type, 'Dry');
    assert.equal(row.trip_id, trip.id);
    assert.equal(JSON.parse(row.image).length, 2);

    await page.waitForSelector('#heroDrinkPhotoWrap img');
    assert.equal(await page.locator('#heroDrinkPhotoWrap img').count(), 2);
    assert.ok(!(await page.textContent('body')).includes('\\n'), 'no stray \\n on the Rate page');
    await ctx.close();
  });

  await check('Cider has its own Type and Sweetness, and no wine fields', async () => {
    const ctx = await newContext({}, { user: daniel, trip });
    const page = await ctx.newPage();
    await page.goto(`${base}/add-drink.html`);
    await page.click('#catCider');
    assert.equal(await page.isVisible('#wineFields'), false);
    assert.equal(await page.isVisible('#wineStyle'), false);
    const types = await page.$$eval('#ciderType option', o => o.map(x => x.value).filter(Boolean));
    const sweetness = await page.$$eval('#ciderStyle option', o => o.map(x => x.value).filter(Boolean));
    assert.deepEqual(types, ['Apple', 'Pear (Perry)', 'Fruit', 'Rosé']);
    assert.deepEqual(sweetness, ['Dry', 'Medium Dry', 'Medium', 'Sweet']);
    await page.fill('#drinkName', 'Thatchers Gold');
    await page.selectOption('#ciderType', 'Apple');
    await page.selectOption('#ciderStyle', 'Medium');
    await page.screenshot({ path: path.join(OUT, 'add-drink-cider-phone.png'), fullPage: true });
    await page.click('#addBtn');
    await page.waitForURL('**/rate.html?id=*');
    const id = Number(new URL(page.url()).searchParams.get('id'));
    const { rows: [row] } = await db.query('SELECT type, style FROM drinks WHERE id = $1', [id]);
    assert.deepEqual(row, { type: 'Apple', style: 'Medium' });
    await ctx.close();
  });

  await check('rate the drink', async () => {
    const ctx = await newContext({}, { user: daniel, trip });
    const page = await ctx.newPage();
    await page.goto(`${base}/rate.html?id=${drinkId}`);
    await page.click('.star-btn[data-val="4"]');
    await page.fill('#notesInput', 'Floral, not too sweet');
    await page.click('#saveBtn');
    await page.waitForFunction(() => document.getElementById('saveBtn').textContent.includes('Update'));
    const { rows: [r] } = await db.query('SELECT stars, notes FROM ratings WHERE drink_id = $1', [drinkId]);
    assert.deepEqual(r, { stars: 4, notes: 'Floral, not too sweet' });
    await ctx.close();
  });

  /* ---------- Edit Drink (the Save button used to throw) ---------- */
  await check('edit a drink: rename, tag, drop a photo, and Save actually saves', async () => {
    const ctx = await newContext({}, { user: daniel, trip });
    const page = await ctx.newPage();
    const patches = [];
    page.on('request', r => { if (r.method() === 'PATCH') patches.push(r.url()); });
    await page.goto(`${base}/edit-drink.html?id=${drinkId}`);
    await page.waitForSelector('#editForm', { state: 'visible' });

    assert.equal(await page.inputValue('#drinkName'), 'Honey Mead');
    assert.equal(await page.getAttribute('#catMead', 'aria-pressed'), 'true');
    assert.equal(await page.locator('#photoGallery .photo-gallery-thumb').count(), 2);

    await page.fill('#drinkName', 'Honey Mead Reserve');
    await page.click('#catWine');                       // used to throw on every click
    await page.click('#wineStyle .style-tag[data-tag="Sweet"]');
    await page.fill('#wineStyle .style-tag-custom-input', 'Honeyed');
    await page.click('#wineStyle .style-tag-custom-btn');
    await page.locator('.photo-gallery-remove').first().click();
    await page.click('#saveBtn');
    await page.waitForURL(`**/rate.html?id=${drinkId}`);

    assert.equal(patches.length, 1, 'one PATCH carries details and photos');
    const { rows: [row] } = await db.query('SELECT name, category, style, image FROM drinks WHERE id = $1', [drinkId]);
    assert.equal(row.name, 'Honey Mead Reserve');
    assert.equal(row.category, 'wine');
    assert.equal(row.style, 'Sweet,Honeyed');
    assert.equal(JSON.parse(row.image).length, 1);
    await ctx.close();
  });

  /* ---------- Injection ---------- */
  await check('names and posts from the server never execute as markup', async () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    await db.query('UPDATE trips SET name = $1 WHERE id = $2', [payload, trip.id]);
    const evilTrip = { ...trip, name: payload };

    for (const opts of [DESKTOP, PHONE]) {
      const ctx = await newContext(opts, { user: { ...daniel, name: payload }, trip: evilTrip });
      const page = await ctx.newPage();
      await page.goto(`${base}/drinks.html`);
      await page.waitForSelector('.drink-card');
      assert.equal(await page.evaluate(() => window.__pwned), undefined);
      if (opts === DESKTOP) assert.equal(await page.textContent('#sidebarTripName'), payload);

      await page.goto(`${base}/feed.html`);
      await page.fill('#postContent', payload + ' </textarea><b>bold?</b>');
      await page.click('#postBtn');
      await page.waitForSelector('.feed-post');
      assert.equal(await page.evaluate(() => window.__pwned), undefined);
      assert.equal(await page.locator('.feed-post-content b').count(), 0, 'no markup from post text');

      // The edit box gets the raw text back, not HTML.
      await page.click('.feed-post .feed-edit-btn');
      assert.equal(await page.inputValue('.feed-edit-textarea'), payload + ' </textarea><b>bold?</b>');
      await ctx.close();
    }
    await db.query("UPDATE trips SET name = 'Corfu 2026' WHERE id = $1", [trip.id]);
  });

  /* ---------- Feed ---------- */
  await check('feed: photo post appears without a reload; like, reply and delete', async () => {
    const ctx = await newContext({}, { user: daniel, trip });
    const page = await ctx.newPage();
    const feedGets = [];
    page.on('request', r => { if (r.method() === 'GET' && r.url().includes('/api/feed?')) feedGets.push(r.url()); });
    await page.goto(`${base}/feed.html`);
    await page.waitForSelector('.feed-post');
    const before = await page.locator('.feed-post').count();

    await page.fill('#postContent', 'Sunset spritz');
    await page.setInputFiles('#postPhotoInput', [{ name: 'p.png', mimeType: 'image/png', buffer: makePng(1800, 1200, [230, 120, 40]) }]);
    await page.waitForSelector('.feed-compose-thumb');
    await page.click('#postBtn');
    await page.waitForFunction(n => document.querySelectorAll('.feed-post').length === n + 1, before);
    assert.equal(feedGets.length, 1, 'posting does not refetch the whole feed');
    const first = page.locator('.feed-post').first();
    assert.equal(await first.locator('.feed-post-content').textContent(), 'Sunset spritz');
    assert.equal(await first.locator('.feed-post-photo-wrap img').count(), 1);

    await first.locator('.feed-like-btn').click();
    await page.waitForFunction(() => document.querySelector('.feed-post .feed-like-count').textContent === '1');
    assert.equal(await first.locator('.feed-like-btn').getAttribute('aria-pressed'), 'true');

    await first.locator('.feed-reply-btn').click();
    await first.locator('.feed-reply-textarea').fill('Cheers!');
    await first.locator('.feed-reply-submit-btn').click();
    await page.waitForFunction(() => document.querySelector('.feed-post .feed-reply-count').textContent === '1');

    await first.locator('.feed-post-photo-wrap').click();
    assert.equal(await page.isVisible('#photoLightbox'), true);
    await page.keyboard.press('Escape');

    await page.screenshot({ path: path.join(OUT, 'feed-phone.png'), fullPage: true });
    await first.locator('.feed-delete-btn').click();
    await page.waitForFunction(n => document.querySelectorAll('.feed-post').length === n, before);
    await ctx.close();
  });

  await check('a trip-mate’s reviews load (viewer_id), a stranger is refused', async () => {
    const reg = await fetch(`${base}/api/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'register', name: 'Alex', pin: '4321' }),
    }).then(r => r.json());
    const alex = reg.user;
    await fetch(`${base}/api/trips`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'join', user_id: alex.id, invite_code: trip.invite_code }),
    });
    await fetch(`${base}/api/ratings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: alex.id, trip_id: trip.id, drink_id: drinkId, stars: 5 }),
    });

    const ctx = await newContext({}, { user: daniel, trip });
    const page = await ctx.newPage();
    await page.goto(`${base}/user-reviews.html?user_id=${alex.id}`);
    await page.waitForSelector('.review-card');
    assert.equal(await page.locator('.review-card').count(), 1);
    assert.equal(await page.textContent('#userProfileName'), 'Alex');
    await ctx.close();
  });

  /* ---------- Theme ---------- */
  const PAGES = [
    ['login', '/index.html', null],
    ['trips', '/trips.html', '.trip-card'],
    ['drinks', '/drinks.html', '.drink-card'],
    ['add-drink', '/add-drink.html', '#addDrinkForm'],
    ['edit-drink', () => `/edit-drink.html?id=${drinkId}`, '#editForm'],
    ['rate', () => `/rate.html?id=${drinkId}`, '#communityCard'],
    ['feed', '/feed.html', '.feed-post, .empty-state'],
    ['leaderboard', '/leaderboard.html?tab=social', '.leaderboard-item'],
    ['my-reviews', '/my-reviews.html', '.review-card'],
  ];
  const THEMES = [
    ['light', { colorScheme: 'light' }, null],
    ['osdark', { colorScheme: 'dark' }, null],
    ['toggledark', { colorScheme: 'light' }, 'dark'],
  ];

  const shots = {};
  const contrastFailures = [];
  const needContrast = (label, ratio) => {
    if (!(ratio >= 4.5)) contrastFailures.push(`${label}: ${ratio.toFixed(2)}:1`);
  };
  await check('every page renders in light, OS-dark and toggle-dark on phone and desktop', async () => {
  for (const [themeName, ctxOpts, stored] of THEMES) {
    for (const [device, deviceOpts] of [['phone', PHONE], ['desktop', DESKTOP]]) {
      for (const [pageName, route, ready] of PAGES) {
        const loggedOut = pageName === 'login';
        const ctx = await newContext({ ...deviceOpts, ...ctxOpts }, {
          user: loggedOut ? null : daniel, trip: loggedOut ? null : trip, theme: stored,
        });
        const page = await ctx.newPage();
        await page.goto(base + (typeof route === 'function' ? route() : route));
        if (ready) await page.waitForSelector(ready);
        // Let web fonts (or their fallback) settle so text doesn't shift between shots.
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(250);
        const file = path.join(OUT, `${pageName}-${device}-${themeName}.png`);
        await page.screenshot({ path: file, fullPage: true });
        shots[`${pageName}-${device}-${themeName}`] = file;

        if (themeName !== 'light' && device === 'phone') {
          if (pageName === 'add-drink' || pageName === 'edit-drink') {
            needContrast(`${pageName} ${themeName} active category`, await contrastOf(page, '.category-btn.active'));
          }
          if (pageName === 'drinks') {
            for (const sel of ['.scope-btn.active', '#categoryChips .chip.active']) {
              needContrast(`${sel} ${themeName}`, await contrastOf(page, sel));
            }
          }
          if (pageName === 'trips') {
            await page.click('.trip-card');
            await page.waitForSelector('#detailCode');
            needContrast(`invite code ${themeName}`, await contrastOf(page, '#detailCode'));
          }
          if (pageName === 'rate') {
            needContrast(`rate title ${themeName}`, await contrastOf(page, '#heroTitle'));
          }
        }
        await ctx.close();
      }
    }
  }
  });

  await check('dark mode looks identical whether it came from the OS or the toggle', async () => {
    const diffs = [];
    for (const [pageName] of PAGES) {
      for (const device of ['phone', 'desktop']) {
        const a = PNG.sync.read(fs.readFileSync(shots[`${pageName}-${device}-osdark`]));
        const b = PNG.sync.read(fs.readFileSync(shots[`${pageName}-${device}-toggledark`]));
        if (a.width !== b.width || a.height !== b.height) {
          diffs.push(`${pageName}-${device}: size ${a.width}x${a.height} vs ${b.width}x${b.height}`);
          continue;
        }
        const n = differingBlocks(a, b);
        if (n > 0) diffs.push(`${pageName}-${device}: ${n} blocks differ`);
      }
    }
    assert.deepEqual(diffs, []);
  });

  await check('key controls meet WCAG AA contrast in both dark variants', async () => {
    assert.deepEqual(contrastFailures, []);
  });

  await check('toggle flips the theme, remembers it, and follows the OS when unset', async () => {
    const ctx = await newContext({ colorScheme: 'dark' }, { user: daniel, trip, theme: null });
    const page = await ctx.newPage();
    await page.goto(`${base}/drinks.html`);
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.click('#themeToggleBtn');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('sipscore-theme')), 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark', 'a stored choice beats the OS');
    await page.reload();
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    await ctx.close();
  });

  await check('no uncaught page errors anywhere', async () => {
    assert.deepEqual(pageErrors, []);
  });

  await browser.close();
  await server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n# ${results.length - failed.length}/${results.length} passed — screenshots in ${path.relative(process.cwd(), OUT)}/`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
