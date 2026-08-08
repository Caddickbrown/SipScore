const { getSql, setCors, ensureSchema, parseId } = require('../lib/db');

module.exports = async (req, res) => {
  setCors(res, 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = getSql();
  await ensureSchema(sql);

  /* -------- GET — list replies for a post -------- */
  if (req.method === 'GET') {
    const postId = parseId(req.query.post_id);
    const viewerId = parseId(req.query.viewer_id);
    if (!postId) return res.status(400).json({ error: 'post_id is required' });

    try {
      const replies = await sql`
        SELECT
          fr.id,
          fr.content,
          fr.created_at,
          fr.parent_reply_id,
          u.id            AS user_id,
          u.name          AS user_name,
          u.avatar_colour,
          u.avatar_image,
          COUNT(frl.id)::int AS like_count,
          BOOL_OR(frl.user_id = ${viewerId}) AS liked_by_viewer
        FROM feed_replies fr
        JOIN users u ON u.id = fr.user_id
        LEFT JOIN feed_reply_likes frl ON frl.reply_id = fr.id
        WHERE fr.post_id = ${postId}
        GROUP BY fr.id, fr.content, fr.created_at, fr.parent_reply_id,
                 u.id, u.name, u.avatar_colour, u.avatar_image
        ORDER BY fr.created_at ASC
      `;
      return res.json({ replies });
    } catch (err) {
      console.error('GET feed-replies error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* -------- POST — create a reply (or sub-reply) -------- */
  if (req.method === 'POST') {
    const { content } = req.body || {};
    const userId = parseId((req.body || {}).user_id);
    const postId = parseId((req.body || {}).post_id);

    if (!userId || !postId || !content || !content.trim()) {
      return res.status(400).json({ error: 'user_id, post_id, and content are required' });
    }

    const trimmed = content.trim();
    if (trimmed.length > 280) {
      return res.status(400).json({ error: 'Reply must be 280 characters or fewer' });
    }

    const parentId = parseId((req.body || {}).parent_reply_id);

    try {
      const [reply] = await sql`
        INSERT INTO feed_replies (post_id, user_id, parent_reply_id, content)
        VALUES (${postId}, ${userId}, ${parentId}, ${trimmed})
        RETURNING id, content, created_at, parent_reply_id
      `;
      return res.status(201).json({ reply });
    } catch (err) {
      console.error('POST feed-replies error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* -------- DELETE — remove own reply -------- */
  if (req.method === 'DELETE') {
    const userId = parseId((req.body || {}).user_id);
    const replyId = parseId((req.body || {}).reply_id);

    if (!userId || !replyId) {
      return res.status(400).json({ error: 'user_id and reply_id are required' });
    }

    try {
      const result = await sql`
        DELETE FROM feed_replies
        WHERE id = ${replyId} AND user_id = ${userId}
        RETURNING id
      `;
      if (result.length === 0) {
        return res.status(404).json({ error: 'Reply not found or not yours' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('DELETE feed-replies error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
