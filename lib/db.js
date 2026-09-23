/* =============================================
   lib/db.js — Shared database access, schema & request plumbing
   ---------------------------------------------
   Lives outside /api so Vercel never turns it into
   a Serverless Function (the Hobby plan caps us at 12).
   ============================================= */

const crypto = require('crypto');
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
   Shared constants
   --------------------------------------------- */

const VALID_CATEGORIES = [
  'wine', 'cocktail', 'beer', 'cider', 'spirit',
  'mocktail', 'hotdrink', 'softdrink', 'milkshake', 'mead', 'other',
];

// Column limits, mirrored by the client-side maxlength attributes.
const LIMITS = {
  drinkName: 200,
  drinkType: 100,
  drinkVarietal: 100,
  drinkStyle: 500,
  drinkSource: 200,
  ratingNotes: 1000,
  postContent: 500,
  replyContent: 280,
};

/* ---------------------------------------------
   Invite codes
   --------------------------------------------- */

// Ambiguous glyphs (O/0, I/1) are left out so codes can be read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 6) {
  const bytes = crypto.randomBytes(length);
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
   Input validation
   --------------------------------------------- */

function parseId(value) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

// Optional free-text field. Returns { value } (null when empty) or { error }.
function cleanText(value, max, label) {
  if (value === null || value === undefined) return { value: null };
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const trimmed = value.trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > max) return { error: `${label} must be ${max} characters or fewer` };
  return { value: trimmed };
}

// Only base64 raster images. Anything that could break out of an attribute
// (quotes, spaces, angle brackets) fails the character class.
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif|heic|heif);base64,[A-Za-z0-9+/]+={0,2}$/;

// Accepts null, a single data URL, or a JSON array of data URLs (as stored in
// drinks.image and feed_posts.image). Returns { value } normalised for storage,
// or { error } with a user-facing message.
function validateImages(value, { maxEach = 400_000, maxCount = 6, allowList = true } = {}) {
  if (value === null || value === undefined || value === '') return { value: null };
  if (typeof value !== 'string') return { error: 'Photos must be sent as image data' };

  let list;
  const isList = value.trim().startsWith('[');
  if (isList) {
    if (!allowList) return { error: 'Only one image is allowed' };
    try { list = JSON.parse(value); } catch { return { error: 'Photos could not be read' }; }
    if (!Array.isArray(list)) return { error: 'Photos could not be read' };
  } else {
    list = [value];
  }

  if (list.length === 0) return { value: null };
  if (list.length > maxCount) return { error: `Maximum ${maxCount} photos` };

  for (const img of list) {
    if (typeof img !== 'string' || !DATA_URL_RE.test(img)) {
      return { error: 'Each photo must be a PNG, JPEG, WebP, GIF or HEIC image' };
    }
    if (img.length > maxEach) {
      return { error: `A photo is too large (max ~${Math.round(maxEach * 0.75 / 1000)} KB each)` };
    }
  }

  return { value: isList ? JSON.stringify(list) : list[0] };
}

// For LIKE/ILIKE patterns built from user input.
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, ch => '\\' + ch);
}

function queryString(value) {
  if (Array.isArray(value)) value = value[0];
  return value === undefined || value === null ? '' : String(value);
}

/* ---------------------------------------------
   Schema
   ---------------------------------------------
   Runs at most once per warm Lambda instance. A single
   cheap probe short-circuits the common (already migrated)
   case so we don't pay ~25 round-trips on every cold start.

   Anything added to the migration below MUST also be added
   to this probe, or existing databases will never get it.
   --------------------------------------------- */

let schemaReady = false;

const CIDER_SWEETNESS = ['Dry', 'Medium Dry', 'Medium', 'Sweet'];

async function isMigrated(sql) {
  const [row] = await sql`
    SELECT
      to_regclass('public.trip_members') IS NOT NULL AS has_members,
      to_regclass('public.ratings_user_drink_trip_key') IS NOT NULL AS has_index,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ratings' AND column_name = 'trip_id'
      ) AS has_rating_trip,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'drinks' AND column_name = 'image'
      ) AS has_drink_image,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'feed_posts' AND column_name = 'image'
      ) AS has_feed_image,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'feed_posts' AND column_name = 'content'
          AND is_nullable = 'YES'
      ) AS has_nullable_content,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'drinks' AND column_name = 'style'
          AND data_type = 'text'
      ) AS has_text_style
  `;
  if (!row) return false;
  if (!(row.has_members && row.has_index && row.has_rating_trip && row.has_drink_image
        && row.has_feed_image && row.has_nullable_content && row.has_text_style)) {
    return false;
  }

  // Checked separately: these tables only exist once the core migration has run.
  const [data] = await sql`
    SELECT
      (to_regclass('public.users_name_lower_key') IS NOT NULL
        OR EXISTS (SELECT 1 FROM users GROUP BY LOWER(name) HAVING COUNT(*) > 1)) AS names_ok,
      NOT EXISTS (
        SELECT 1 FROM drinks WHERE category = 'cider' AND type = ANY(${CIDER_SWEETNESS})
      ) AS ciders_ok
  `;
  return Boolean(data && data.names_ok && data.ciders_ok);
}

async function columnExists(sql, table, column) {
  const [row] = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS present
  `;
  return Boolean(row && row.present);
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
      style TEXT,
      source VARCHAR(200),
      added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_seeded BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE drinks ADD COLUMN IF NOT EXISTS varietal VARCHAR(100)`;
  await sql`ALTER TABLE drinks ADD COLUMN IF NOT EXISTS image TEXT`;
  // style holds comma-joined tags; three 40-char custom tags overflowed VARCHAR(100).
  await sql`ALTER TABLE drinks ALTER COLUMN style TYPE TEXT`;

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
  await sql`ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS image TEXT`;
  await sql`ALTER TABLE feed_posts ALTER COLUMN content DROP NOT NULL`;
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

// Legacy data is anything written before trips existed: the ratings.trip_id
// column was missing, or ratings/posts still have no trip (a previous
// migration died half-way). Seeded catalogue drinks legitimately have no trip,
// so they alone never make a database "legacy".
async function needsLegacyBackfill(sql, hadRatingTripColumn) {
  if (!hadRatingTripColumn) return true;
  const [row] = await sql`
    SELECT
      EXISTS (SELECT 1 FROM ratings WHERE trip_id IS NULL)
      OR EXISTS (SELECT 1 FROM feed_posts WHERE trip_id IS NULL) AS orphans
  `;
  return Boolean(row && row.orphans);
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
      VALUES ('Corfu', 'Corfu', ${code}, ${ownerId})
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

// Names are matched case-insensitively at sign-in, so enforce that in the
// database too. Skipped (with a warning) if case-variant duplicates already
// exist, since creating the index would fail and block every request.
async function migrateNameUniqueness(sql) {
  const dupes = await sql`
    SELECT LOWER(name) AS name FROM users GROUP BY LOWER(name) HAVING COUNT(*) > 1 LIMIT 5
  `;
  if (dupes.length > 0) {
    console.warn('Skipping users_name_lower_key: case-variant duplicate names exist', dupes);
    return;
  }
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_name_lower_key ON users (LOWER(name))`;
}

// Cider's "Sweetness" field used to be stored in drinks.type, mixed with types
// (Rosé, Sparkling). Sweetness now lives in style; move old values across.
async function migrateCiderSweetness(sql) {
  await sql`
    UPDATE drinks
    SET style = COALESCE(style, type), type = NULL
    WHERE category = 'cider' AND type = ANY(${CIDER_SWEETNESS})
  `;
}

async function runMigrations(sql) {
  // Read before createTripTables adds it, to tell a legacy database apart.
  const hadRatingTripColumn = await columnExists(sql, 'ratings', 'trip_id');

  await createCoreTables(sql);
  await createTripTables(sql);
  if (await needsLegacyBackfill(sql, hadRatingTripColumn)) {
    await backfillLegacyTrip(sql);
  }
  await migrateRatingUniqueness(sql);
  await migrateNameUniqueness(sql);
  await migrateCiderSweetness(sql);
}

// Two cold starts can migrate at once. The HTTP driver can't hold a session
// advisory lock across statements, so instead retry once when the other
// instance wins a CREATE race (duplicate type/relation/object).
const MIGRATION_RACE_CODES = new Set(['23505', '42P07', '42710']);

async function ensureSchema(sqlMaybe) {
  const sql = sqlMaybe || getSql();
  if (schemaReady) return sql;

  if (await isMigrated(sql)) {
    schemaReady = true;
    return sql;
  }

  try {
    await runMigrations(sql);
  } catch (err) {
    if (!MIGRATION_RACE_CODES.has(err && err.code)) throw err;
    await new Promise(resolve => setTimeout(resolve, 250));
    await runMigrations(sql);
  }

  schemaReady = true;
  return sql;
}

/* ---------------------------------------------
   Handler wrapper
   ---------------------------------------------
   Every API route goes through this: CORS, JSON content type,
   OPTIONS, method check, schema, and a catch-all that never
   leaks database errors to the client.
   --------------------------------------------- */

const PG_ERROR_RESPONSES = {
  '23503': [404, 'That item no longer exists'],
  '23505': [409, 'That already exists'],
  '22001': [400, 'A value is too long'],
  '22007': [400, 'Invalid date'],
  '22008': [400, 'Invalid date'],
  '22P02': [400, 'Invalid value'],
};

function withHandler(methods, handler) {
  const allowed = [...methods, 'OPTIONS'].join(', ');
  return async (req, res) => {
    setCors(res, allowed);
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!methods.includes(req.method)) {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const sql = await ensureSchema();
      req.query = req.query || {};
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      return await handler(req, res, sql, body);
    } catch (err) {
      console.error(`${req.method} ${req.url || ''} failed:`, err);
      if (res.headersSent || res.ended) return undefined;
      const mapped = err && PG_ERROR_RESPONSES[err.code];
      if (mapped) return res.status(mapped[0]).json({ error: mapped[1] });
      return res.status(500).json({ error: 'Server error' });
    }
  };
}

/* ---------------------------------------------
   Trips & membership
   ---------------------------------------------
   The app authenticates with a name + PIN and then passes user_id
   around, so these checks are about keeping trips separate rather
   than defending against a determined attacker.
   --------------------------------------------- */

// Trip rows enriched with the counts the trip switcher shows. Pass tripId to
// fetch just one of the caller's trips.
async function tripsForUser(sql, userId, tripId = null) {
  return sql`
    SELECT
      t.id, t.name, t.destination, t.start_date, t.end_date,
      t.invite_code, t.created_by_user_id, t.created_at,
      tm.role,
      (SELECT COUNT(*)::int FROM trip_members m WHERE m.trip_id = t.id) AS member_count,
      (SELECT COUNT(*)::int FROM drinks d WHERE d.trip_id = t.id)       AS drink_count,
      (SELECT COUNT(*)::int FROM ratings r WHERE r.trip_id = t.id)      AS rating_count,
      (SELECT COUNT(*)::int FROM ratings r
         WHERE r.trip_id = t.id AND r.user_id = ${userId})              AS my_rating_count
    FROM trips t
    JOIN trip_members tm ON tm.trip_id = t.id AND tm.user_id = ${userId}
    WHERE (${tripId}::int IS NULL OR t.id = ${tripId})
    ORDER BY COALESCE(t.start_date, t.created_at::date) DESC, t.id DESC
  `;
}

async function tripForUser(sql, userId, tripId) {
  const [trip] = await tripsForUser(sql, userId, tripId);
  return trip || null;
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

// Resolves a post and checks the user is on its trip.
async function requirePostMembership(sql, res, postId, userId) {
  const [post] = await sql`
    SELECT p.id, p.trip_id, p.user_id, (tm.user_id IS NOT NULL) AS is_member
    FROM feed_posts p
    LEFT JOIN trip_members tm ON tm.trip_id = p.trip_id AND tm.user_id = ${userId}
    WHERE p.id = ${postId}
  `;
  if (!post) {
    res.status(404).json({ error: 'Post not found' });
    return null;
  }
  if (!post.is_member) {
    res.status(403).json({ error: 'You are not a member of this trip' });
    return null;
  }
  return post;
}

// Resolves a reply (via its post) and checks the user is on that trip.
async function requireReplyMembership(sql, res, replyId, userId) {
  const [reply] = await sql`
    SELECT r.id, r.post_id, p.trip_id, (tm.user_id IS NOT NULL) AS is_member
    FROM feed_replies r
    JOIN feed_posts p ON p.id = r.post_id
    LEFT JOIN trip_members tm ON tm.trip_id = p.trip_id AND tm.user_id = ${userId}
    WHERE r.id = ${replyId}
  `;
  if (!reply) {
    res.status(404).json({ error: 'Reply not found' });
    return null;
  }
  if (!reply.is_member) {
    res.status(403).json({ error: 'You are not a member of this trip' });
    return null;
  }
  return reply;
}

module.exports = {
  getSql,
  setCors,
  ensureSchema,
  withHandler,
  VALID_CATEGORIES,
  LIMITS,
  uniqueInviteCode,
  normaliseCode,
  parseId,
  cleanText,
  validateImages,
  escapeLike,
  queryString,
  tripsForUser,
  tripForUser,
  getMembership,
  requireMembership,
  requirePostMembership,
  requireReplyMembership,
};
