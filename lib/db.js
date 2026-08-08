/* =============================================
   lib/db.js — Shared database access & schema
   ---------------------------------------------
   Lives outside /api so Vercel never turns it into
   a Serverless Function (the Hobby plan caps us at 12).
   ============================================= */

const { neon } = require('@neondatabase/serverless');

function getSql() {
  return neon(process.env.DATABASE_URL);
}

function setCors(res, methods = 'GET, POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ---------------------------------------------
   Invite codes
   --------------------------------------------- */

// Ambiguous glyphs (O/0, I/1) are left out so codes can be read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 6) {
  const bytes = require('crypto').randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

async function uniqueInviteCode(sql) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode();
    const existing = await sql`SELECT 1 FROM trips WHERE invite_code = ${code}`;
    if (existing.length === 0) return code;
  }
  // Astronomically unlikely; widen the code rather than fail the request.
  return randomCode(10);
}

function normaliseCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* ---------------------------------------------
   Schema
   ---------------------------------------------
   Runs at most once per warm Lambda instance. A single
   cheap probe short-circuits the common (already migrated)
   case so we don't pay ~20 round-trips on every cold start.
   --------------------------------------------- */

let schemaReady = false;

async function isMigrated(sql) {
  const [row] = await sql`
    SELECT
      to_regclass('public.trip_members') IS NOT NULL AS has_members,
      to_regclass('public.ratings_user_drink_trip_key') IS NOT NULL AS has_index,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ratings' AND column_name = 'trip_id'
      ) AS has_rating_trip
  `;
  return Boolean(row && row.has_members && row.has_index && row.has_rating_trip);
}

async function createCoreTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) UNIQUE NOT NULL,
      pin_hash VARCHAR(128) NOT NULL,
      pin_salt VARCHAR(32) NOT NULL,
      avatar_colour VARCHAR(7) NOT NULL DEFAULT '#c9a96e',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_image TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS drinks (
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
    )
  `;
  await sql`ALTER TABLE drinks ADD COLUMN IF NOT EXISTS varietal VARCHAR(100)`;

  await sql`
    CREATE TABLE IF NOT EXISTS ratings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      drink_id INTEGER NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
      stars SMALLINT NOT NULL CHECK (stars >= 1 AND stars <= 5),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS feed_posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS feed_likes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, post_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS feed_replies (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_reply_id INTEGER REFERENCES feed_replies(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE feed_replies ADD COLUMN IF NOT EXISTS parent_reply_id INTEGER REFERENCES feed_replies(id) ON DELETE CASCADE`;
  await sql`
    CREATE TABLE IF NOT EXISTS feed_reply_likes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reply_id INTEGER NOT NULL REFERENCES feed_replies(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, reply_id)
    )
  `;
}

async function createTripTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS trips (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      destination VARCHAR(120),
      start_date DATE,
      end_date DATE,
      invite_code VARCHAR(12) UNIQUE NOT NULL,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS trip_members (
      id SERIAL PRIMARY KEY,
      trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(10) NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(trip_id, user_id)
    )
  `;

  // drinks.trip_id records the trip a drink was *added on*. The catalogue is
  // shared, so a drink stays visible everywhere — this is what the "This trip"
  // filter keys off. ON DELETE SET NULL keeps the drink in the global catalogue
  // when its originating trip is deleted.
  await sql`ALTER TABLE drinks ADD COLUMN IF NOT EXISTS trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL`;
  // Ratings and posts belong to the trip they happened on and go with it.
  await sql`ALTER TABLE ratings ADD COLUMN IF NOT EXISTS trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE`;

  await sql`CREATE INDEX IF NOT EXISTS drinks_trip_idx ON drinks (trip_id)`;
  await sql`CREATE INDEX IF NOT EXISTS ratings_trip_idx ON ratings (trip_id)`;
  await sql`CREATE INDEX IF NOT EXISTS feed_posts_trip_idx ON feed_posts (trip_id)`;
  await sql`CREATE INDEX IF NOT EXISTS trip_members_user_idx ON trip_members (user_id)`;
}

// Everything that existed before trips came along was one holiday. Fold it into
// a real trip so no history is stranded, and enrol every existing user in it.
async function backfillLegacyTrip(sql) {
  const [{ count: tripCount }] = await sql`SELECT COUNT(*)::int AS count FROM trips`;

  if (tripCount === 0) {
    const [{ has_data: hasData }] = await sql`
      SELECT (EXISTS (SELECT 1 FROM drinks) OR EXISTS (SELECT 1 FROM ratings)) AS has_data
    `;
    // A brand-new database has nothing to rescue — its drinks are seeded straight
    // into the shared catalogue and the first real trip is created by a user.
    if (!hasData) return;

    const [owner] = await sql`SELECT id FROM users ORDER BY id LIMIT 1`;
    const ownerId = owner ? owner.id : null;
    const code = await uniqueInviteCode(sql);

    const [trip] = await sql`
      INSERT INTO trips (name, destination, invite_code, created_by_user_id)
      VALUES ('Corfu', 'Ikos Resorts, Corfu', ${code}, ${ownerId})
      RETURNING id
    `;

    await sql`
      INSERT INTO trip_members (trip_id, user_id, role)
      SELECT ${trip.id}, id, CASE WHEN id = ${ownerId} THEN 'owner' ELSE 'member' END
      FROM users
      ON CONFLICT (trip_id, user_id) DO NOTHING
    `;
  }

  // Attach any still-unassigned rows to the oldest trip.
  await sql`
    UPDATE drinks SET trip_id = (SELECT id FROM trips ORDER BY id LIMIT 1)
    WHERE trip_id IS NULL AND EXISTS (SELECT 1 FROM trips)
  `;
  await sql`
    UPDATE ratings SET trip_id = (SELECT id FROM trips ORDER BY id LIMIT 1)
    WHERE trip_id IS NULL AND EXISTS (SELECT 1 FROM trips)
  `;
  await sql`
    UPDATE feed_posts SET trip_id = (SELECT id FROM trips ORDER BY id LIMIT 1)
    WHERE trip_id IS NULL AND EXISTS (SELECT 1 FROM trips)
  `;
}

// A rating is now unique per (user, drink, trip) rather than per (user, drink),
// so the same Mojito can be rated again on the next holiday.
async function migrateRatingUniqueness(sql) {
  await sql`ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_user_id_drink_id_key`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ratings_user_drink_trip_key
    ON ratings (user_id, drink_id, trip_id)
  `;
}

async function ensureSchema(sqlMaybe) {
  const sql = sqlMaybe || getSql();
  if (schemaReady) return sql;

  if (await isMigrated(sql)) {
    schemaReady = true;
    return sql;
  }

  await createCoreTables(sql);
  await createTripTables(sql);
  await backfillLegacyTrip(sql);
  await migrateRatingUniqueness(sql);

  schemaReady = true;
  return sql;
}

/* ---------------------------------------------
   Trip membership
   ---------------------------------------------
   The app authenticates with a name + PIN and then passes user_id
   around, so these checks are about keeping trips separate rather
   than defending against a determined attacker.
   --------------------------------------------- */

function parseId(value) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

async function getMembership(sql, tripId, userId) {
  if (!tripId || !userId) return null;
  const [row] = await sql`
    SELECT role FROM trip_members WHERE trip_id = ${tripId} AND user_id = ${userId}
  `;
  return row || null;
}

// Returns the membership, or writes an error response and returns null.
async function requireMembership(sql, res, tripId, userId) {
  const membership = await getMembership(sql, tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'You are not a member of this trip' });
    return null;
  }
  return membership;
}

module.exports = {
  getSql,
  setCors,
  ensureSchema,
  uniqueInviteCode,
  normaliseCode,
  parseId,
  getMembership,
  requireMembership,
};
