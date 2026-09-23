const { withHandler, parseId, requirePostMembership } = require('../lib/db');

module.exports = withHandler(['POST'], async (req, res, sql, body) => {
  const userId = parseId(body.user_id);
  const postId = parseId(body.post_id);
  if (!userId || !postId) {
    return res.status(400).json({ error: 'user_id and post_id are required' });
  }

  const post = await requirePostMembership(sql, res, postId, userId);
  if (!post) return undefined;

  // Toggle: try to add the like; if it was already there, remove it instead.
  const inserted = await sql`
    INSERT INTO feed_likes (user_id, post_id)
    VALUES (${userId}, ${postId})
    ON CONFLICT (user_id, post_id) DO NOTHING
    RETURNING id
  `;
  let liked = true;
  if (inserted.length === 0) {
    await sql`DELETE FROM feed_likes WHERE user_id = ${userId} AND post_id = ${postId}`;
    liked = false;
  }

  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM feed_likes WHERE post_id = ${postId}
  `;
  return res.json({ liked, like_count: count });
});
