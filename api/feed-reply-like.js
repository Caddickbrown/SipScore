const { neon } = require('@neondatabase/serverless');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function ensureTable(sql) {
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

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, reply_id } = req.body || {};
  if (!user_id || !reply_id) {
    return res.status(400).json({ error: 'user_id and reply_id are required' });
  }

  const sql = neon(process.env.DATABASE_URL);
  await ensureTable(sql);

  try {
    const existing = await sql`
      SELECT id FROM feed_reply_likes
      WHERE user_id = ${parseInt(user_id)} AND reply_id = ${parseInt(reply_id)}
    `;

    let liked;
    if (existing.length > 0) {
      await sql`
        DELETE FROM feed_reply_likes
        WHERE user_id = ${parseInt(user_id)} AND reply_id = ${parseInt(reply_id)}
      `;
      liked = false;
    } else {
      await sql`
        INSERT INTO feed_reply_likes (user_id, reply_id)
        VALUES (${parseInt(user_id)}, ${parseInt(reply_id)})
        ON CONFLICT DO NOTHING
      `;
      liked = true;
    }

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM feed_reply_likes WHERE reply_id = ${parseInt(reply_id)}
    `;

    return res.json({ liked, like_count: count });
  } catch (err) {
    console.error('POST feed-reply-like error:', err);
    return res.status(500).json({ error: err.message });
  }
};
