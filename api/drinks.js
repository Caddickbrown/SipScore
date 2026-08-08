const { getSql, setCors, ensureSchema, parseId, requireMembership } = require('../lib/db');

const VALID_CATEGORIES = [
  'wine', 'cocktail', 'beer', 'cider', 'spirit',
  'mocktail', 'hotdrink', 'softdrink', 'milkshake',
];

module.exports = async (req, res) => {
  setCors(res, 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = getSql();
  await ensureSchema(sql);

  /* -------- GET — list/search drinks -------- */
  if (req.method === 'GET') {
    const { search = '', category = '', type = '', scope = 'trip' } = req.query;
    const userId = parseId(req.query.user_id);
    const tripId = parseId(req.query.trip_id);

    // The catalogue is shared across trips: "trip" shows what was added on this
    // holiday, "all" opens up everything anyone has ever added.
    const tripOnly = scope !== 'all' && Boolean(tripId);

    try {
      const drinks = await sql`
        SELECT
          d.id, d.name, d.category, d.type, d.varietal, d.style, d.source, d.image,
          d.trip_id, d.created_at,
          ROUND(AVG(r.stars) FILTER (
            WHERE ${tripId}::int IS NULL OR r.trip_id = ${tripId}
          )::numeric, 1) AS avg_stars,
          COUNT(r.id) FILTER (
            WHERE ${tripId}::int IS NULL OR r.trip_id = ${tripId}
          )::int AS rating_count,
          ROUND(AVG(r.stars)::numeric, 1) AS overall_avg_stars,
          COUNT(r.id)::int                AS overall_rating_count,
          MAX(r.stars) FILTER (
            WHERE r.user_id = ${userId}
              AND (${tripId}::int IS NULL OR r.trip_id = ${tripId})
          ) AS my_stars
        FROM drinks d
        LEFT JOIN ratings r ON r.drink_id = d.id
        WHERE
          (${search} = '' OR
            LOWER(d.name) LIKE LOWER(${'%' + search + '%'}) OR
            LOWER(d.category) LIKE LOWER(${'%' + search + '%'}) OR
            LOWER(COALESCE(d.type, '')) LIKE LOWER(${'%' + search + '%'}) OR
            LOWER(COALESCE(d.varietal, '')) LIKE LOWER(${'%' + search + '%'}) OR
            LOWER(COALESCE(d.style, '')) LIKE LOWER(${'%' + search + '%'}) OR
            LOWER(COALESCE(d.source, '')) LIKE LOWER(${'%' + search + '%'})
          )
          AND (${category} = '' OR d.category = ${category})
          AND (${type} = '' OR d.type = ${type})
          AND (${tripOnly} = false OR d.trip_id = ${tripId})
        GROUP BY d.id
        ORDER BY d.name
      `;

      return res.json({ drinks, scope: tripOnly ? 'trip' : 'all' });
    } catch (err) {
      console.error('GET drinks error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* -------- POST — add a new drink -------- */
  if (req.method === 'POST') {
    const { name, category, type, varietal, style, source, image } = req.body || {};
    const userId = parseId((req.body || {}).user_id);
    const tripId = parseId((req.body || {}).trip_id);

    if (!name || !category || !userId) {
      return res.status(400).json({ error: 'Name, category, and user_id are required' });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const trimmedName = String(name).trim();
    if (trimmedName.length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters' });
    }

    // Validate optional image
    const drinkImage = image || null;
    if (drinkImage !== null) {
      if (typeof drinkImage !== 'string' || !drinkImage.startsWith('data:image/')) {
        return res.status(400).json({ error: 'image must be a valid image data URL' });
      }
      if (drinkImage.length > 400_000) {
        return res.status(400).json({ error: 'Image is too large (max ~300 KB)' });
      }
    }

    try {
      // A drink is tagged with the trip it was added on, but stays in the
      // shared catalogue so other trips can find and rate it too.
      if (tripId) {
        const membership = await requireMembership(sql, res, tripId, userId);
        if (!membership) return;
      }

      const [drink] = await sql`
        INSERT INTO drinks (name, category, type, varietal, style, source, image, added_by_user_id, trip_id)
        VALUES (${trimmedName}, ${category}, ${type || null}, ${varietal || null},
                ${style || null}, ${source || null}, ${drinkImage}, ${userId}, ${tripId})
        RETURNING id, name, category, type, varietal, style, source, image, trip_id
      `;
      return res.status(201).json({ drink });
    } catch (err) {
      console.error('POST drink error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
