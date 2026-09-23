const {
  withHandler,
  parseId,
  LIMITS,
  cleanText,
  validateImages,
  requireMembership,
} = require('../lib/db');

const PAGE_SIZE = 50;
// Feed photos are resized to 1200px client-side; allow some headroom per image.
// The client also keeps the whole request under Vercel's 4.5 MB body limit.
const FEED_IMAGE_OPTIONS = { maxEach: 900_000, maxCount: 6 };

/* -------- GET — posts for a trip (or all the viewer's trips), newest first -------- */
async function handleGet(req, res, sql) {
  const viewerId = parseId(req.query.user_id);
  const tripId = parseId(req.query.trip_id);
  const beforeId = parseId(req.query.before_id);

  if (!viewerId) return res.status(400).json({ error: 'user_id is required' });

  if (tripId) {
    const membership = await requireMembership(sql, res, tripId, viewerId);
    if (!membership) return undefined;
  }

  // Counts come from correlated subqueries rather than joining likes and
  // replies together, which multiplied rows (likes × replies) per post.
  const rows = await sql`
    SELECT
      fp.id, fp.content, fp.image, fp.created_at, fp.trip_id,
      u.id AS user_id, u.name AS user_name, u.avatar_colour, u.avatar_image,
      (SELECT COUNT(*)::int FROM feed_likes fl WHERE fl.post_id = fp.id) AS like_count,
      EXISTS (
        SELECT 1 FROM feed_likes fl WHERE fl.post_id = fp.id AND fl.user_id = ${viewerId}
      ) AS liked_by_viewer,
      (SELECT COUNT(*)::int FROM feed_replies fr WHERE fr.post_id = fp.id) AS reply_count
    FROM feed_posts fp
    JOIN users u ON u.id = fp.user_id
    WHERE CASE WHEN ${tripId}::int IS NOT NULL THEN fp.trip_id = ${tripId}
               ELSE fp.trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = ${viewerId})
          END
      AND (${beforeId}::int IS NULL OR fp.id < ${beforeId})
    ORDER BY fp.id DESC
    LIMIT ${PAGE_SIZE + 1}
  `;

  const hasMore = rows.length > PAGE_SIZE;
  return res.json({ posts: rows.slice(0, PAGE_SIZE), has_more: hasMore });
}

/* -------- POST — create a post -------- */
async function handlePost(req, res, sql, body) {
  const userId = parseId(body.user_id);
  const tripId = parseId(body.trip_id);

  const content = cleanText(body.content, LIMITS.postContent, 'Post');
  if (content.error) return res.status(400).json({ error: content.error });

  const image = validateImages(body.image, FEED_IMAGE_OPTIONS);
  if (image.error) return res.status(400).json({ error: image.error });

  if (!userId || (!content.value && !image.value)) {
    return res.status(400).json({ error: 'Write something or add a photo' });
  }
  if (!tripId) {
    return res.status(400).json({ error: 'Pick a trip before posting' });
  }

  const membership = await requireMembership(sql, res, tripId, userId);
  if (!membership) return undefined;

  // Returned in the same shape as GET so the client can show it straight away.
  const [post] = await sql`
    WITH p AS (
      INSERT INTO feed_posts (user_id, trip_id, content, image)
      VALUES (${userId}, ${tripId}, ${content.value}, ${image.value})
      RETURNING id, content, image, created_at, trip_id, user_id
    )
    SELECT
      p.id, p.content, p.image, p.created_at, p.trip_id,
      u.id AS user_id, u.name AS user_name, u.avatar_colour, u.avatar_image,
      0 AS like_count, false AS liked_by_viewer, 0 AS reply_count
    FROM p JOIN users u ON u.id = p.user_id
  `;
  return res.status(201).json({ post });
}

/* -------- PATCH — edit own post content -------- */
// Ownership is the check for editing and deleting: you can always tidy up
// your own posts, even after leaving the trip.
async function handlePatch(req, res, sql, body) {
  const userId = parseId(body.user_id);
  const postId = parseId(body.post_id);

  const content = cleanText(body.content, LIMITS.postContent, 'Post');
  if (content.error) return res.status(400).json({ error: content.error });

  if (!userId || !postId) {
    return res.status(400).json({ error: 'user_id and post_id are required' });
  }

  // A photo-only post can have its caption cleared; a text-only one can't be emptied.
  const result = await sql`
    UPDATE feed_posts
    SET content = ${content.value}
    WHERE id = ${postId} AND user_id = ${userId}
      AND (${content.value}::text IS NOT NULL OR image IS NOT NULL)
    RETURNING id, content
  `;
  if (result.length === 0) {
    if (!content.value) return res.status(400).json({ error: 'A post needs text or a photo' });
    return res.status(404).json({ error: 'Post not found or not yours' });
  }
  return res.json({ post: result[0] });
}

/* -------- DELETE — remove own post -------- */
async function handleDelete(req, res, sql, body) {
  const userId = parseId(body.user_id);
  const postId = parseId(body.post_id);

  if (!userId || !postId) {
    return res.status(400).json({ error: 'user_id and post_id are required' });
  }

  const result = await sql`
    DELETE FROM feed_posts
    WHERE id = ${postId} AND user_id = ${userId}
    RETURNING id
  `;
  if (result.length === 0) {
    return res.status(404).json({ error: 'Post not found or not yours' });
  }
  return res.json({ success: true });
}

module.exports = withHandler(['GET', 'POST', 'PATCH', 'DELETE'], async (req, res, sql, body) => {
  if (req.method === 'GET') return handleGet(req, res, sql);
  if (req.method === 'POST') return handlePost(req, res, sql, body);
  if (req.method === 'PATCH') return handlePatch(req, res, sql, body);
  return handleDelete(req, res, sql, body);
});
