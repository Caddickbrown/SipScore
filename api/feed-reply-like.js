const { withHandler, parseId, requireReplyMembership } = require('../lib/db');

module.exports = withHandler(['POST'], async (req, res, sql, body) => {
  const userId = parseId(body.user_id);
  const replyId = parseId(body.reply_id);
  if (!userId || !replyId) {
    return res.status(400).json({ error: 'user_id and reply_id are required' });
  }

  const reply = await requireReplyMembership(sql, res, replyId, userId);
  if (!reply) return undefined;

  // Toggle: try to add the like; if it was already there, remove it instead.
  const inserted = await sql`
    INSERT INTO feed_reply_likes (user_id, reply_id)
    VALUES (${userId}, ${replyId})
    ON CONFLICT (user_id, reply_id) DO NOTHING
    RETURNING id
  `;
  let liked = true;
  if (inserted.length === 0) {
    await sql`DELETE FROM feed_reply_likes WHERE user_id = ${userId} AND reply_id = ${replyId}`;
    liked = false;
  }

  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM feed_reply_likes WHERE reply_id = ${replyId}
  `;
  return res.json({ liked, like_count: count });
});
