const { withHandler, parseId, validateImages } = require('../lib/db');

// Avatars are cropped to 100×100 client-side; ~150 KB of image is plenty.
const AVATAR_IMAGE_OPTIONS = { maxEach: 200_000, maxCount: 1, allowList: false };

/* -------- GET — fetch user profile by id -------- */
async function handleGet(req, res, sql) {
  const id = parseId(req.query.id);
  // Scoped to a trip when given, so a profile shows what they rated *here*.
  const tripId = parseId(req.query.trip_id);
  if (!id) return res.status(400).json({ error: 'id is required' });

  const rows = await sql`
    SELECT u.id, u.name, u.avatar_colour, u.avatar_image,
      COUNT(r.id) FILTER (
        WHERE ${tripId}::int IS NULL OR r.trip_id = ${tripId}
      )::int AS rating_count,
      COUNT(r.id)::int AS overall_rating_count,
      (SELECT COUNT(*)::int FROM trip_members tm WHERE tm.user_id = u.id) AS trip_count
    FROM users u
    LEFT JOIN ratings r ON r.user_id = u.id
    WHERE u.id = ${id}
    GROUP BY u.id
  `;

  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: rows[0] });
}

/* -------- PATCH — set or clear the avatar -------- */
async function handlePatch(req, res, sql, body) {
  const userId = parseId(body.user_id);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });

  const image = validateImages(body.avatar_image, AVATAR_IMAGE_OPTIONS);
  if (image.error) {
    return res.status(400).json({ error: 'Avatar must be a PNG, JPEG, WebP, GIF or HEIC image under ~150 KB' });
  }

  const [user] = await sql`
    UPDATE users
    SET avatar_image = ${image.value}
    WHERE id = ${userId}
    RETURNING id, name, avatar_colour, avatar_image
  `;

  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user });
}

module.exports = withHandler(['GET', 'PATCH'], async (req, res, sql, body) => {
  if (req.method === 'GET') return handleGet(req, res, sql);
  return handlePatch(req, res, sql, body);
});
