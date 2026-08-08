const { getSql, setCors, ensureSchema, parseId } = require('../lib/db');

module.exports = async (req, res) => {
  setCors(res, 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = parseId((req.body || {}).user_id);
  const replyId = parseId((req.body || {}).reply_id);
  if (!userId || !replyId) {
    return res.status(400).json({ error: 'user_id and reply_id are required' });
  }

  const sql = getSql();
  await ensureSchema(sql);

  try {
    const existing = await sql`
      SELECT id FROM feed_reply_likes WHERE user_id = ${userId} AND reply_id = ${replyId}
    `;

    let liked;
    if (existing.length > 0) {
      await sql`DELETE FROM feed_reply_likes WHERE user_id = ${userId} AND reply_id = ${replyId}`;
      liked = false;
    } else {
      await sql`
        INSERT INTO feed_reply_likes (user_id, reply_id)
        VALUES (${userId}, ${replyId})
        ON CONFLICT DO NOTHING
      `;
      liked = true;
    }

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM feed_reply_likes WHERE reply_id = ${replyId}
    `;

    return res.json({ liked, like_count: count });
  } catch (err) {
    console.error('POST feed-reply-like error:', err);
    return res.status(500).json({ error: err.message });
  }
};
