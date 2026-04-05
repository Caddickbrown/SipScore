const { neon } = require('@neondatabase/serverless');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function ensureColumn(sql) {
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_image TEXT`;
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);
  await ensureColumn(sql);

  // GET — fetch user profile by id
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id is required' });

    try {
      const rows = await sql`
        SELECT u.id, u.name, u.avatar_colour, u.avatar_image,
          COUNT(r.id)::int AS rating_count
        FROM users u
        LEFT JOIN ratings r ON r.user_id = u.id
        WHERE u.id = ${parseInt(id)}
        GROUP BY u.id
      `;

      if (!rows.length) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({ user: rows[0] });
    } catch (err) {
      console.error('GET profile error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, avatar_image } = req.body || {};

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  // avatar_image can be null (to remove) or a base64 data URL
  if (avatar_image !== null && avatar_image !== undefined) {
    if (typeof avatar_image !== 'string') {
      return res.status(400).json({ error: 'avatar_image must be a string or null' });
    }
    // Sanity-check: must be a data URL or null
    if (!avatar_image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'avatar_image must be a valid image data URL' });
    }
    // Cap at ~200KB base64 (~150KB image) to prevent abuse
    if (avatar_image.length > 200000) {
      return res.status(400).json({ error: 'Avatar image is too large' });
    }
  }

  try {
    const [user] = await sql`
      UPDATE users
      SET avatar_image = ${avatar_image ?? null}
      WHERE id = ${parseInt(user_id)}
      RETURNING id, name, avatar_colour, avatar_image
    `;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });
  } catch (err) {
    console.error('PATCH profile error:', err);
    return res.status(500).json({ error: err.message });
  }
};
