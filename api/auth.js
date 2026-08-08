const crypto = require('crypto');
const { getSql, setCors, ensureSchema } = require('../lib/db');

const AVATAR_COLOURS = [
  '#c9a96e', '#1a6b5c', '#7c5cbf', '#c17b5c',
  '#4a8fa8', '#c4526c', '#5a7d5a', '#a06b3c',
];

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPin(pin, salt) {
  return crypto.createHmac('sha256', salt).update(String(pin)).digest('hex');
}

// Returned on sign-in so the client can pick an active trip straight away
// instead of making a second round-trip.
async function tripsForUser(sql, userId) {
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
    ORDER BY COALESCE(t.start_date, t.created_at::date) DESC, t.id DESC
  `;
}

module.exports = async (req, res) => {
  setCors(res, 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();
  const { action, name, pin } = req.body || {};

  if (!name || !pin) {
    return res.status(400).json({ error: 'Name and PIN are required' });
  }

  const trimmedName = String(name).trim();
  const pinStr = String(pin).trim();

  if (trimmedName.length < 2 || trimmedName.length > 30) {
    return res.status(400).json({ error: 'Name must be 2–30 characters' });
  }

  if (!/^\d{4}$/.test(pinStr)) {
    return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
  }

  try {
    await ensureSchema(sql);

    if (action === 'register') {
      const existing = await sql`
        SELECT id FROM users WHERE LOWER(name) = LOWER(${trimmedName})
      `;
      if (existing.length > 0) {
        return res.status(409).json({ error: 'That name is already taken — choose another!' });
      }

      const salt = generateSalt();
      const pinHash = hashPin(pinStr, salt);
      const avatarColour = AVATAR_COLOURS[Math.floor(Math.random() * AVATAR_COLOURS.length)];

      const [user] = await sql`
        INSERT INTO users (name, pin_hash, pin_salt, avatar_colour)
        VALUES (${trimmedName}, ${pinHash}, ${salt}, ${avatarColour})
        RETURNING id, name, avatar_colour, avatar_image
      `;

      return res.json({ user, trips: [] });

    } else if (action === 'login') {
      const [user] = await sql`
        SELECT id, name, pin_hash, pin_salt, avatar_colour, avatar_image
        FROM users
        WHERE LOWER(name) = LOWER(${trimmedName})
      `;

      if (!user) {
        return res.status(404).json({ error: 'No profile found with that name' });
      }

      const pinHash = hashPin(pinStr, user.pin_salt);
      if (pinHash !== user.pin_hash) {
        return res.status(401).json({ error: 'Incorrect PIN' });
      }

      const trips = await tripsForUser(sql, user.id);

      return res.json({
        user: {
          id: user.id,
          name: user.name,
          avatar_colour: user.avatar_colour,
          avatar_image: user.avatar_image || null,
        },
        trips,
      });

    } else {
      return res.status(400).json({ error: 'Invalid action. Use "register" or "login"' });
    }
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
