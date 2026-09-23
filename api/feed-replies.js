const {
  withHandler,
  parseId,
  LIMITS,
  cleanText,
  requirePostMembership,
} = require('../lib/db');

/* -------- GET — list replies for a post -------- */
async function handleGet(req, res, sql) {
  const postId = parseId(req.query.post_id);
  const viewerId = parseId(req.query.viewer_id);
  if (!postId) return res.status(400).json({ error: 'post_id is required' });
  if (!viewerId) return res.status(400).json({ error: 'viewer_id is required' });

  const post = await requirePostMembership(sql, res, postId, viewerId);
  if (!post) return undefined;

  const replies = await sql`
    SELECT
      fr.id, fr.content, fr.created_at, fr.parent_reply_id,
      u.id AS user_id, u.name AS user_name, u.avatar_colour, u.avatar_image,
      (SELECT COUNT(*)::int FROM feed_reply_likes l WHERE l.reply_id = fr.id) AS like_count,
      EXISTS (
        SELECT 1 FROM feed_reply_likes l WHERE l.reply_id = fr.id AND l.user_id = ${viewerId}
      ) AS liked_by_viewer
    FROM feed_replies fr
    JOIN users u ON u.id = fr.user_id
    WHERE fr.post_id = ${postId}
    ORDER BY fr.created_at ASC, fr.id ASC
  `;
  return res.json({ replies });
}

/* -------- POST — create a reply (or sub-reply) -------- */
async function handlePost(req, res, sql, body) {
  const userId = parseId(body.user_id);
  const postId = parseId(body.post_id);
  const parentId = parseId(body.parent_reply_id);

  const content = cleanText(body.content, LIMITS.replyContent, 'Reply');
  if (content.error) return res.status(400).json({ error: content.error });
  if (!userId || !postId || !content.value) {
    return res.status(400).json({ error: 'user_id, post_id, and content are required' });
  }

  const post = await requirePostMembership(sql, res, postId, userId);
  if (!post) return undefined;

  if (parentId) {
    const [parent] = await sql`
      SELECT id FROM feed_replies WHERE id = ${parentId} AND post_id = ${postId}
    `;
    if (!parent) return res.status(404).json({ error: 'The reply you answered was removed' });
  }

  const [reply] = await sql`
    INSERT INTO feed_replies (post_id, user_id, parent_reply_id, content)
    VALUES (${postId}, ${userId}, ${parentId}, ${content.value})
    RETURNING id, content, created_at, parent_reply_id
  `;
  return res.status(201).json({ reply });
}

/* -------- DELETE — remove own reply -------- */
async function handleDelete(req, res, sql, body) {
  const userId = parseId(body.user_id);
  const replyId = parseId(body.reply_id);

  if (!userId || !replyId) {
    return res.status(400).json({ error: 'user_id and reply_id are required' });
  }

  const result = await sql`
    DELETE FROM feed_replies
    WHERE id = ${replyId} AND user_id = ${userId}
    RETURNING id
  `;
  if (result.length === 0) {
    return res.status(404).json({ error: 'Reply not found or not yours' });
  }
  return res.json({ success: true });
}

module.exports = withHandler(['GET', 'POST', 'DELETE'], async (req, res, sql, body) => {
  if (req.method === 'GET') return handleGet(req, res, sql);
  if (req.method === 'POST') return handlePost(req, res, sql, body);
  return handleDelete(req, res, sql, body);
});
