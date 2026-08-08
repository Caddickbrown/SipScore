/* =============================================
   tests/trips.integration.test.js
   ---------------------------------------------
   Exercises the trip-scoping work against a real Postgres.

   Skipped unless TEST_DATABASE_URL points at a server the test may
   create throwaway databases on, e.g.

     TEST_DATABASE_URL=postgres://postgres@/postgres?host=/tmp&port=55432 \
       node --test tests/
   ============================================= */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('pg');
const { installShim, call } = require('./helpers/neon-shim');

const ADMIN_URL = process.env.TEST_DATABASE_URL;

if (!ADMIN_URL) {
  test('trip integration tests (skipped — set TEST_DATABASE_URL)', { skip: true }, () => {});
  return;
}

let dbCounter = 0;

function urlForDatabase(name) {
  const url = new URL(ADMIN_URL.replace(/^postgres(ql)?:\/\//, 'http://'));
  url.pathname = '/' + name;
  return url.toString().replace(/^http:\/\//, 'postgres://');
}

// Fresh database + freshly-required modules per test, because lib/db caches
// "schema is migrated" for the lifetime of a warm Lambda (and so, a process).
async function freshApp(seedLegacy) {
  const name = `sipscore_test_${process.pid}_${++dbCounter}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const client = new Client({ connectionString: urlForDatabase(name) });
  await client.connect();

  if (seedLegacy) await seedLegacy(client);

  // Reset module state so ensureSchema actually runs against this database.
  for (const key of Object.keys(require.cache)) {
    if (/[\\/](lib[\\/]db|api[\\/][^\\/]+)\.js$/.test(key)) delete require.cache[key];
  }
  installShim(client);

  const api = name => require(path.join(__dirname, '..', 'api', name));
  return {
    client,
    db: require(path.join(__dirname, '..', 'lib', 'db')),
    trips: api('trips.js'),
    drinks: api('drinks.js'),
    drink: api('drink.js'),
    ratings: api('ratings.js'),
    leaderboard: api('leaderboard.js'),
    feed: api('feed.js'),
    auth: api('auth.js'),
    profile: api('profile.js'),
    seed: api('seed.js'),
    async close() { await client.end(); },
  };
}

/* ---------------------------------------------
   The schema exactly as it stood before trips existed.
   --------------------------------------------- */
async function legacySchema(client) {
  await client.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) UNIQUE NOT NULL,
      pin_hash VARCHAR(128) NOT NULL,
      pin_salt VARCHAR(32) NOT NULL,
      avatar_colour VARCHAR(7) NOT NULL DEFAULT '#c9a96e',
      avatar_image TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE drinks (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      category VARCHAR(20) NOT NULL,
      type VARCHAR(100),
      varietal VARCHAR(100),
      style VARCHAR(100),
      source VARCHAR(200),
      added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_seeded BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE ratings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      drink_id INTEGER NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
      stars SMALLINT NOT NULL CHECK (stars >= 1 AND stars <= 5),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, drink_id)
    );
    CREATE TABLE feed_posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.query(`
    INSERT INTO users (name, pin_hash, pin_salt) VALUES
      ('Daniel', 'h', 's'), ('Alex', 'h', 's'), ('Sam', 'h', 's');
    INSERT INTO drinks (name, category, type, is_seeded) VALUES
      ('Corfiata', 'wine', 'White', true),
      ('Mojito', 'cocktail', 'Rum-based', true),
      ('Mythos', 'beer', 'Lager', false);
    INSERT INTO ratings (user_id, drink_id, stars, notes) VALUES
      (1, 1, 5, 'Lovely'), (2, 1, 4, NULL), (1, 2, 3, NULL), (3, 3, 4, NULL);
    INSERT INTO feed_posts (user_id, content) VALUES (1, 'First round on me');
  `);
}

async function registerUser(app, name) {
  const res = await call(app.auth, 'POST', {
    body: { action: 'register', name, pin: '1234' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.user;
}

/* =============================================
   Migration of an existing single-holiday database
   ============================================= */

test('migration folds the existing holiday into a real trip', async (t) => {
  const app = await freshApp(legacySchema);
  t.after(() => app.close());

  await app.db.ensureSchema();

  const { rows: trips } = await app.client.query('SELECT * FROM trips');
  assert.equal(trips.length, 1, 'one legacy trip is created');
  assert.equal(trips[0].name, 'Corfu');
  assert.match(trips[0].invite_code, /^[A-Z0-9]{6}$/);

  const tripId = trips[0].id;

  // Nothing is left stranded outside a trip.
  for (const table of ['drinks', 'ratings', 'feed_posts']) {
    const { rows } = await app.client.query(
      `SELECT COUNT(*)::int AS n FROM ${table} WHERE trip_id IS DISTINCT FROM $1`, [tripId]
    );
    assert.equal(rows[0].n, 0, `${table} all attached to the legacy trip`);
  }

  // Everyone who was already using the app is a member; the first is owner.
  const { rows: members } = await app.client.query(
    'SELECT user_id, role FROM trip_members WHERE trip_id = $1 ORDER BY user_id', [tripId]
  );
  assert.deepEqual(members.map(m => m.user_id), [1, 2, 3]);
  assert.equal(members[0].role, 'owner');
  assert.equal(members[1].role, 'member');
});

test('migration is idempotent and re-runnable', async (t) => {
  const app = await freshApp(legacySchema);
  t.after(() => app.close());

  await app.db.ensureSchema();
  const { rows: first } = await app.client.query('SELECT COUNT(*)::int AS n FROM trips');

  // Simulate a cold start against an already-migrated database.
  delete require.cache[require.resolve('../lib/db')];
  const db2 = require('../lib/db');
  await db2.ensureSchema();

  const { rows: second } = await app.client.query('SELECT COUNT(*)::int AS n FROM trips');
  assert.equal(second[0].n, first[0].n, 'no duplicate legacy trip on the second run');
});

test('the same drink can be rated again on a different trip', async (t) => {
  const app = await freshApp(legacySchema);
  t.after(() => app.close());
  await app.db.ensureSchema();

  const { rows: [legacy] } = await app.client.query('SELECT id FROM trips');

  // The old UNIQUE(user_id, drink_id) constraint must be gone...
  const { rows: constraints } = await app.client.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'ratings'::regclass AND conname = 'ratings_user_id_drink_id_key'
  `);
  assert.equal(constraints.length, 0, 'old per-drink uniqueness dropped');

  const created = await call(app.trips, 'POST', {
    body: { action: 'create', user_id: 1, name: 'Amalfi', destination: 'Italy' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const amalfi = created.body.trip.id;
  assert.notEqual(amalfi, legacy.id);

  // Daniel rated drink 1 five stars on the Corfu trip; rating it again on
  // Amalfi must create a second row rather than overwrite the first.
  const again = await call(app.ratings, 'POST', {
    body: { user_id: 1, drink_id: 1, trip_id: amalfi, stars: 2, notes: 'Not as good here' },
  });
  assert.equal(again.status, 200, JSON.stringify(again.body));

  const { rows } = await app.client.query(
    'SELECT trip_id, stars FROM ratings WHERE user_id = 1 AND drink_id = 1 ORDER BY trip_id'
  );
  assert.equal(rows.length, 2, 'both holidays keep their own rating');
  assert.deepEqual(rows.map(r => r.stars).sort(), [2, 5]);

  // ...and re-rating on the same trip still updates in place.
  await call(app.ratings, 'POST', {
    body: { user_id: 1, drink_id: 1, trip_id: amalfi, stars: 4 },
  });
  const { rows: after } = await app.client.query(
    'SELECT COUNT(*)::int AS n FROM ratings WHERE user_id = 1 AND drink_id = 1'
  );
  assert.equal(after[0].n, 2, 'upsert, not insert, within a trip');
});

/* =============================================
   A brand-new database
   ============================================= */

test('a fresh database seeds into the shared catalogue with no trip', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());

  const res = await call(app.seed, 'POST', {});
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const { rows: trips } = await app.client.query('SELECT COUNT(*)::int AS n FROM trips');
  assert.equal(trips[0].n, 0, 'no phantom legacy trip on a clean install');

  const { rows: drinks } = await app.client.query(
    'SELECT COUNT(*)::int AS n FROM drinks WHERE trip_id IS NULL AND is_seeded'
  );
  assert.equal(drinks[0].n, 57, 'seeded drinks are catalogue-wide');
});

/* =============================================
   Trips API
   ============================================= */

test('create, share by code, and join a trip', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());

  const daniel = await registerUser(app, 'Daniel');
  const alex = await registerUser(app, 'Alex');

  const created = await call(app.trips, 'POST', {
    body: {
      action: 'create', user_id: daniel.id,
      name: 'Amalfi Coast', destination: 'Positano, Italy',
      start_date: '2026-09-01', end_date: '2026-09-10',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const trip = created.body.trip;
  assert.equal(trip.role, 'owner');
  assert.equal(trip.member_count, 1);
  assert.match(trip.invite_code, /^[A-Z0-9]{6}$/);

  // Alex previews the trip from the code before committing.
  const preview = await call(app.trips, 'GET', {
    query: { code: trip.invite_code.toLowerCase(), user_id: String(alex.id) },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.trip.name, 'Amalfi Coast');
  assert.equal(preview.body.trip.role, null, 'not a member yet');
  assert.equal(preview.body.trip.invite_code, undefined, 'code lookup does not leak the code back');

  const joined = await call(app.trips, 'POST', {
    body: { action: 'join', user_id: alex.id, invite_code: trip.invite_code },
  });
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
  assert.equal(joined.body.trip.role, 'member');
  assert.equal(joined.body.trip.member_count, 2);

  // Joining twice is harmless.
  const again = await call(app.trips, 'POST', {
    body: { action: 'join', user_id: alex.id, invite_code: trip.invite_code },
  });
  assert.equal(again.status, 201);

  const mine = await call(app.trips, 'GET', { query: { user_id: String(alex.id) } });
  assert.equal(mine.body.trips.length, 1);

  const bad = await call(app.trips, 'POST', {
    body: { action: 'join', user_id: alex.id, invite_code: 'ZZZZZZ' },
  });
  assert.equal(bad.status, 404);
});

test('trip edits and deletion are owner-only', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());

  const daniel = await registerUser(app, 'Daniel');
  const alex = await registerUser(app, 'Alex');

  const { body: { trip } } = await call(app.trips, 'POST', {
    body: { action: 'create', user_id: daniel.id, name: 'Corfu' },
  });
  await call(app.trips, 'POST', {
    body: { action: 'join', user_id: alex.id, invite_code: trip.invite_code },
  });

  const rejected = await call(app.trips, 'PATCH', {
    body: { user_id: alex.id, trip_id: trip.id, name: 'Alex was here' },
  });
  assert.equal(rejected.status, 403);

  const renamed = await call(app.trips, 'PATCH', {
    body: { user_id: daniel.id, trip_id: trip.id, name: 'Corfu 2026', destination: 'Ikos' },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.trip.name, 'Corfu 2026');

  const badDates = await call(app.trips, 'PATCH', {
    body: {
      user_id: daniel.id, trip_id: trip.id, name: 'Corfu',
      start_date: '2026-09-10', end_date: '2026-09-01',
    },
  });
  assert.equal(badDates.status, 400);

  // The owner can't quietly walk away from a trip other people are on.
  const ownerLeave = await call(app.trips, 'DELETE', {
    body: { user_id: daniel.id, trip_id: trip.id, action: 'leave' },
  });
  assert.equal(ownerLeave.status, 409);

  const memberLeave = await call(app.trips, 'DELETE', {
    body: { user_id: alex.id, trip_id: trip.id, action: 'leave' },
  });
  assert.equal(memberLeave.status, 200);
  assert.equal(memberLeave.body.deleted, false);

  const deleted = await call(app.trips, 'DELETE', {
    body: { user_id: daniel.id, trip_id: trip.id, action: 'delete' },
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
});

test('non-members are kept out of a trip', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());

  const daniel = await registerUser(app, 'Daniel');
  const stranger = await registerUser(app, 'Stranger');

  const { body: { trip } } = await call(app.trips, 'POST', {
    body: { action: 'create', user_id: daniel.id, name: 'Corfu' },
  });

  const rate = await call(app.ratings, 'POST', {
    body: { user_id: stranger.id, drink_id: 1, trip_id: trip.id, stars: 5 },
  });
  assert.equal(rate.status, 403);

  const post = await call(app.feed, 'POST', {
    body: { user_id: stranger.id, trip_id: trip.id, content: 'hello' },
  });
  assert.equal(post.status, 403);

  const read = await call(app.feed, 'GET', {
    query: { user_id: String(stranger.id), trip_id: String(trip.id) },
  });
  assert.equal(read.status, 403);

  const detail = await call(app.trips, 'GET', {
    query: { id: String(trip.id), user_id: String(stranger.id) },
  });
  assert.equal(detail.status, 403);
});

/* =============================================
   Trip-scoped drinks, ratings, rankings and feed
   ============================================= */

async function twoTripFixture(app) {
  const daniel = await registerUser(app, 'Daniel');
  const alex = await registerUser(app, 'Alex');

  const { body: { trip: corfu } } = await call(app.trips, 'POST', {
    body: { action: 'create', user_id: daniel.id, name: 'Corfu' },
  });
  const { body: { trip: amalfi } } = await call(app.trips, 'POST', {
    body: { action: 'create', user_id: daniel.id, name: 'Amalfi' },
  });
  await call(app.trips, 'POST', {
    body: { action: 'join', user_id: alex.id, invite_code: corfu.invite_code },
  });

  const add = async (tripId, name, category) => {
    const res = await call(app.drinks, 'POST', {
      body: { user_id: daniel.id, trip_id: tripId, name, category },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.drink;
  };

  const corfiata = await add(corfu.id, 'Corfiata', 'wine');
  const mythos = await add(corfu.id, 'Mythos', 'beer');
  const limoncello = await add(amalfi.id, 'Limoncello', 'spirit');

  return { daniel, alex, corfu, amalfi, corfiata, mythos, limoncello };
}

test('drinks list filters by trip but the catalogue stays shared', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const f = await twoTripFixture(app);

  const trip = await call(app.drinks, 'GET', {
    query: { user_id: String(f.daniel.id), trip_id: String(f.corfu.id), scope: 'trip' },
  });
  assert.equal(trip.body.scope, 'trip');
  assert.deepEqual(trip.body.drinks.map(d => d.name).sort(), ['Corfiata', 'Mythos']);

  const all = await call(app.drinks, 'GET', {
    query: { user_id: String(f.daniel.id), trip_id: String(f.corfu.id), scope: 'all' },
  });
  assert.equal(all.body.scope, 'all');
  assert.deepEqual(
    all.body.drinks.map(d => d.name).sort(),
    ['Corfiata', 'Limoncello', 'Mythos'],
    'the whole catalogue is reachable from any trip'
  );

  const search = await call(app.drinks, 'GET', {
    query: {
      user_id: String(f.daniel.id), trip_id: String(f.corfu.id),
      scope: 'all', search: 'limon',
    },
  });
  assert.deepEqual(search.body.drinks.map(d => d.name), ['Limoncello']);
});

test('ratings, averages and my_stars are scoped to the active trip', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const f = await twoTripFixture(app);

  // Corfiata: 5 + 3 on Corfu, 1 on Amalfi (same drink, different holiday).
  await call(app.ratings, 'POST', {
    body: { user_id: f.daniel.id, drink_id: f.corfiata.id, trip_id: f.corfu.id, stars: 5 },
  });
  await call(app.ratings, 'POST', {
    body: { user_id: f.alex.id, drink_id: f.corfiata.id, trip_id: f.corfu.id, stars: 3 },
  });
  await call(app.ratings, 'POST', {
    body: { user_id: f.daniel.id, drink_id: f.corfiata.id, trip_id: f.amalfi.id, stars: 1 },
  });

  const corfuList = await call(app.drinks, 'GET', {
    query: { user_id: String(f.daniel.id), trip_id: String(f.corfu.id), scope: 'trip' },
  });
  const corfiataOnCorfu = corfuList.body.drinks.find(d => d.name === 'Corfiata');
  assert.equal(Number(corfiataOnCorfu.avg_stars), 4, 'trip average ignores the other holiday');
  assert.equal(corfiataOnCorfu.rating_count, 2);
  assert.equal(Number(corfiataOnCorfu.overall_avg_stars), 3, 'all-time average spans trips');
  assert.equal(corfiataOnCorfu.overall_rating_count, 3);
  assert.equal(corfiataOnCorfu.my_stars, 5, 'my rating on *this* trip');

  const amalfiList = await call(app.drinks, 'GET', {
    query: { user_id: String(f.daniel.id), trip_id: String(f.amalfi.id), scope: 'all' },
  });
  const corfiataOnAmalfi = amalfiList.body.drinks.find(d => d.name === 'Corfiata');
  assert.equal(corfiataOnAmalfi.my_stars, 1);
  assert.equal(Number(corfiataOnAmalfi.avg_stars), 1);

  // Drink detail carries the same split.
  const detail = await call(app.drink, 'GET', {
    query: {
      id: String(f.corfiata.id), user_id: String(f.daniel.id), trip_id: String(f.corfu.id),
    },
  });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.drink.rating_count, 2);
  assert.equal(detail.body.drink.overall_rating_count, 3);
  assert.equal(detail.body.drink.trips_rated_on, 2);
  assert.equal(detail.body.ratings.length, 2, 'only this trip\'s reviews are listed');
  assert.equal(detail.body.myRating.stars, 5);

  // Deleting a rating only affects the trip it was made on.
  await call(app.ratings, 'DELETE', {
    body: { user_id: f.daniel.id, drink_id: f.corfiata.id, trip_id: f.amalfi.id },
  });
  const { rows } = await app.client.query(
    'SELECT COUNT(*)::int AS n FROM ratings WHERE drink_id = $1', [f.corfiata.id]
  );
  assert.equal(rows[0].n, 2);
});

test('rankings are scoped to the trip, and all-time without one', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const f = await twoTripFixture(app);

  await call(app.ratings, 'POST', {
    body: { user_id: f.daniel.id, drink_id: f.corfiata.id, trip_id: f.corfu.id, stars: 5 },
  });
  await call(app.ratings, 'POST', {
    body: { user_id: f.daniel.id, drink_id: f.mythos.id, trip_id: f.corfu.id, stars: 2 },
  });
  await call(app.ratings, 'POST', {
    body: { user_id: f.daniel.id, drink_id: f.limoncello.id, trip_id: f.amalfi.id, stars: 4 },
  });

  for (const type of ['social', 'consensus', 'personal']) {
    const scoped = await call(app.leaderboard, 'GET', {
      query: { type, user_id: String(f.daniel.id), trip_id: String(f.corfu.id) },
    });
    assert.equal(scoped.status, 200, `${type}: ${JSON.stringify(scoped.body)}`);
    const names = scoped.body.leaderboard.map(r => r.name).sort();
    assert.deepEqual(names, ['Corfiata', 'Mythos'], `${type} board is trip-scoped`);

    const allTime = await call(app.leaderboard, 'GET', {
      query: { type, user_id: String(f.daniel.id) },
    });
    assert.equal(allTime.status, 200);
    assert.equal(allTime.body.leaderboard.length, 3, `${type} board spans trips without trip_id`);
  }

  const personal = await call(app.leaderboard, 'GET', {
    query: { type: 'personal', user_id: String(f.daniel.id) },
  });
  const limoncello = personal.body.leaderboard.find(r => r.name === 'Limoncello');
  assert.equal(limoncello.trip_name, 'Amalfi', 'personal board says which trip each rating is from');
});

test('the feed is per-trip', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());
  const f = await twoTripFixture(app);

  await call(app.feed, 'POST', {
    body: { user_id: f.daniel.id, trip_id: f.corfu.id, content: 'Corfu sunset' },
  });
  await call(app.feed, 'POST', {
    body: { user_id: f.daniel.id, trip_id: f.amalfi.id, content: 'Amalfi lemons' },
  });

  const corfuFeed = await call(app.feed, 'GET', {
    query: { user_id: String(f.daniel.id), trip_id: String(f.corfu.id) },
  });
  assert.deepEqual(corfuFeed.body.posts.map(p => p.content), ['Corfu sunset']);

  const alexFeed = await call(app.feed, 'GET', {
    query: { user_id: String(f.alex.id), trip_id: String(f.corfu.id) },
  });
  assert.equal(alexFeed.body.posts.length, 1, 'members of the trip see it');

  const noTrip = await call(app.feed, 'POST', {
    body: { user_id: f.daniel.id, content: 'where does this go?' },
  });
  assert.equal(noTrip.status, 400);
});

test('sign-in returns the trips you belong to', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());

  const daniel = await registerUser(app, 'Daniel');
  await call(app.trips, 'POST', {
    body: { action: 'create', user_id: daniel.id, name: 'Corfu' },
  });

  const login = await call(app.auth, 'POST', {
    body: { action: 'login', name: 'Daniel', pin: '1234' },
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.trips.length, 1);
  assert.equal(login.body.trips[0].name, 'Corfu');

  const profile = await call(app.profile, 'GET', { query: { id: String(daniel.id) } });
  assert.equal(profile.body.user.trip_count, 1);
});

test('a client that predates trips still works when the user has one trip', async (t) => {
  const app = await freshApp();
  t.after(() => app.close());

  const daniel = await registerUser(app, 'Daniel');
  const { body: { trip } } = await call(app.trips, 'POST', {
    body: { action: 'create', user_id: daniel.id, name: 'Corfu' },
  });
  const { body: { drink } } = await call(app.drinks, 'POST', {
    body: { user_id: daniel.id, trip_id: trip.id, name: 'Corfiata', category: 'wine' },
  });

  // No trip_id in the body — the old web client's request shape.
  const res = await call(app.ratings, 'POST', {
    body: { user_id: daniel.id, drink_id: drink.id, stars: 4 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.rating.trip_id, trip.id);

  // With two trips it's genuinely ambiguous, so ask rather than guess.
  await call(app.trips, 'POST', {
    body: { action: 'create', user_id: daniel.id, name: 'Amalfi' },
  });
  const ambiguous = await call(app.ratings, 'POST', {
    body: { user_id: daniel.id, drink_id: drink.id, stars: 2 },
  });
  assert.equal(ambiguous.status, 400);
});
