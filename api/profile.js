const { getSql, setCors, ensureSchema, parseId } = require('../lib/db');

module.exports = async (req, res) => {
  setCors(res, 'GET, PATCH, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = getSql();
  await ensureSchema(sql);

  /* -------- GET — fetch user profile by id -------- */
  if (req.method === 'GET') {
    const id = parseId(req.query.id);
    // Scoped to a trip when given, so a profile shows what they rated *here*.
    const tripId = parseId(req.query.trip_id);
    if (!id) return res.status(400).json({ error: 'id is required' });

    try {
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

      if (!rows.length) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({ user: rows[0] });
    } catch (err) {
      console.error('GET profile error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const { avatar_image } = req.body || {};
  const userId = parseId((req.body || {}).user_id);

  if (!userId) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  // avatar_image can be null (to remove) or a base64 data URL
  if (avatar_image !== null && avatar_image !== undefined) {
    if (typeof avatar_image !== 'string') {
      return res.status(400).json({ error: 'avatar_image must be a string or null' });
    }
    // Sanity-check: must be a data URL or null
    if (!avatar_image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'avatar_image must be a valid image data URL' });
    }
    // Cap at ~200KB base64 (~150KB image) to prevent abuse
    if (avatar_image.length > 200000) {
      return res.status(400).json({ error: 'Avatar image is too large' });
    }
  }

  try {
    const [user] = await sql`
      UPDATE users
      SET avatar_image = ${avatar_image ?? null}
      WHERE id = ${userId}
      RETURNING id, name, avatar_colour, avatar_image
    `;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });
  } catch (err) {
    console.error('PATCH profile error:', err);
    return res.status(500).json({ error: err.message });
  }
};
