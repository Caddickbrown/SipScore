const { neon } = require('@neondatabase/serverless');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, post_id } = req.body || {};
  if (!user_id || !post_id) {
    return res.status(400).json({ error: 'user_id and post_id are required' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // Toggle: if like exists remove it, otherwise insert it
    const existing = await sql`
      SELECT id FROM feed_likes
      WHERE user_id = ${parseInt(user_id)} AND post_id = ${parseInt(post_id)}
    `;

    let liked;
    if (existing.length > 0) {
      await sql`
        DELETE FROM feed_likes
        WHERE user_id = ${parseInt(user_id)} AND post_id = ${parseInt(post_id)}
      `;
      liked = false;
    } else {
      await sql`
        INSERT INTO feed_likes (user_id, post_id)
        VALUES (${parseInt(user_id)}, ${parseInt(post_id)})
        ON CONFLICT DO NOTHING
      `;
      liked = true;
    }

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM feed_likes WHERE post_id = ${parseInt(post_id)}
    `;

    return res.json({ liked, like_count: count });
  } catch (err) {
    console.error('POST feed-like error:', err);
    return res.status(500).json({ error: err.message });
  }
};
