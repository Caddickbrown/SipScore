const { getSql, setCors, ensureSchema, parseId, requireMembership } = require('../lib/db');

module.exports = async (req, res) => {
  setCors(res, 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = getSql();
  await ensureSchema(sql);

  /* -------- GET — posts for a trip, newest first -------- */
  if (req.method === 'GET') {
    const viewerId = parseId(req.query.user_id);
    const tripId = parseId(req.query.trip_id);

    try {
      if (tripId && viewerId) {
        const membership = await requireMembership(sql, res, tripId, viewerId);
        if (!membership) return;
      }

      const posts = await sql`
        SELECT
          fp.id,
          fp.content,
          fp.created_at,
          fp.trip_id,
          u.id            AS user_id,
          u.name          AS user_name,
          u.avatar_colour,
          u.avatar_image,
          COUNT(DISTINCT fl.id)::int AS like_count,
          BOOL_OR(fl.user_id = ${viewerId}) AS liked_by_viewer,
          COUNT(DISTINCT fr.id)::int AS reply_count
        FROM feed_posts fp
        JOIN users u ON u.id = fp.user_id
        LEFT JOIN feed_likes fl ON fl.post_id = fp.id
        LEFT JOIN feed_replies fr ON fr.post_id = fp.id
        WHERE ${tripId}::int IS NULL OR fp.trip_id = ${tripId}
        GROUP BY fp.id, fp.content, fp.created_at, fp.trip_id,
                 u.id, u.name, u.avatar_colour, u.avatar_image
        ORDER BY fp.created_at DESC
        LIMIT 100
      `;
      return res.json({ posts });
    } catch (err) {
      console.error('GET feed error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* -------- POST — create a post -------- */
  if (req.method === 'POST') {
    const { content } = req.body || {};
    const userId = parseId((req.body || {}).user_id);
    const tripId = parseId((req.body || {}).trip_id);

    if (!userId || !content || !content.trim()) {
      return res.status(400).json({ error: 'user_id and content are required' });
    }

    const trimmed = content.trim();
    if (trimmed.length > 500) {
      return res.status(400).json({ error: 'Content must be 500 characters or fewer' });
    }
    if (!tripId) {
      return res.status(400).json({ error: 'Pick a trip before posting' });
    }

    try {
      const membership = await requireMembership(sql, res, tripId, userId);
      if (!membership) return;

      const [post] = await sql`
        INSERT INTO feed_posts (user_id, trip_id, content)
        VALUES (${userId}, ${tripId}, ${trimmed})
        RETURNING id, content, created_at, trip_id
      `;
      return res.status(201).json({ post });
    } catch (err) {
      console.error('POST feed error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* -------- DELETE — remove own post -------- */
  if (req.method === 'DELETE') {
    const userId = parseId((req.body || {}).user_id);
    const postId = parseId((req.body || {}).post_id);

    if (!userId || !postId) {
      return res.status(400).json({ error: 'user_id and post_id are required' });
    }

    try {
      const result = await sql`
        DELETE FROM feed_posts
        WHERE id = ${postId} AND user_id = ${userId}
        RETURNING id
      `;
      if (result.length === 0) {
        return res.status(404).json({ error: 'Post not found or not yours' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('DELETE feed error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
