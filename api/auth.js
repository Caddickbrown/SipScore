const crypto = require('crypto');
const { withHandler, tripsForUser } = require('../lib/db');

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

// Constant-time comparison so response timing doesn't reveal how close a guess was.
function hashesMatch(a, b) {
  const left = Buffer.from(String(a), 'hex');
  const right = Buffer.from(String(b), 'hex');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

module.exports = withHandler(['POST'], async (req, res, sql, body) => {
  const { action, name, pin } = body;

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

  if (action === 'register') {
    const existing = await sql`
      SELECT id FROM users WHERE LOWER(name) = LOWER(${trimmedName})
    `;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'That name is already taken — choose another!' });
    }

    const salt = generateSalt();
    const pinHash = hashPin(pinStr, salt);
    const avatarColour = AVATAR_COLOURS[crypto.randomInt(AVATAR_COLOURS.length)];

    try {
      const [user] = await sql`
        INSERT INTO users (name, pin_hash, pin_salt, avatar_colour)
        VALUES (${trimmedName}, ${pinHash}, ${salt}, ${avatarColour})
        RETURNING id, name, avatar_colour, avatar_image
      `;
      return res.json({ user, trips: [] });
    } catch (err) {
      // Lost a race with someone registering the same name.
      if (err && err.code === '23505') {
        return res.status(409).json({ error: 'That name is already taken — choose another!' });
      }
      throw err;
    }
  }

  if (action === 'login') {
    const [user] = await sql`
      SELECT id, name, pin_hash, pin_salt, avatar_colour, avatar_image
      FROM users
      WHERE LOWER(name) = LOWER(${trimmedName})
      ORDER BY id
      LIMIT 1
    `;

    if (!user) {
      return res.status(404).json({ error: 'No profile found with that name' });
    }

    if (!hashesMatch(hashPin(pinStr, user.pin_salt), user.pin_hash)) {
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
  }

  return res.status(400).json({ error: 'Invalid action. Use "register" or "login"' });
});
