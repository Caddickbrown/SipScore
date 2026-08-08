const { getSql, setCors, ensureSchema, parseId } = require('../lib/db');

module.exports = async (req, res) => {
  setCors(res, 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = parseId((req.body || {}).user_id);
  const postId = parseId((req.body || {}).post_id);
  if (!userId || !postId) {
    return res.status(400).json({ error: 'user_id and post_id are required' });
  }

  const sql = getSql();
  await ensureSchema(sql);

  try {
    // Toggle: if like exists remove it, otherwise insert it
    const existing = await sql`
      SELECT id FROM feed_likes WHERE user_id = ${userId} AND post_id = ${postId}
    `;

    let liked;
    if (existing.length > 0) {
      await sql`DELETE FROM feed_likes WHERE user_id = ${userId} AND post_id = ${postId}`;
      liked = false;
    } else {
      await sql`
        INSERT INTO feed_likes (user_id, post_id)
        VALUES (${userId}, ${postId})
        ON CONFLICT DO NOTHING
      `;
      liked = true;
    }

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM feed_likes WHERE post_id = ${postId}
    `;

    return res.json({ liked, like_count: count });
  } catch (err) {
    console.error('POST feed-like error:', err);
    return res.status(500).json({ error: err.message });
  }
};
