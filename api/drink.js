const { getSql, setCors, ensureSchema, parseId, requireMembership } = require('../lib/db');

const VALID_CATEGORIES = [
  'wine', 'cocktail', 'beer', 'cider', 'spirit',
  'mocktail', 'hotdrink', 'softdrink', 'milkshake',
];

module.exports = async (req, res) => {
  setCors(res, 'GET, PATCH, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const drinkId = parseId(req.query.id);
  if (!drinkId) return res.status(400).json({ error: 'Invalid drink ID' });

  const sql = getSql();
  await ensureSchema(sql);

  /* -------- PATCH — update drink info -------- */
  if (req.method === 'PATCH') {
    const { name, category, type, varietal, style, source } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    try {
      const [updated] = await sql`
        UPDATE drinks
        SET
          name     = ${name.trim()},
          category = COALESCE(${category || null}, category),
          type     = ${type || null},
          varietal = ${varietal || null},
          style    = ${style || null},
          source   = ${source || null}
        WHERE id = ${drinkId}
        RETURNING id, name, category, type, varietal, style, source, image, trip_id
      `;

      if (!updated) return res.status(404).json({ error: 'Drink not found' });
      return res.json({ drink: updated });
    } catch (err) {
      console.error('PATCH drink error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* -------- GET — drink detail + ratings -------- */
  const userId = parseId(req.query.user_id);
  const tripId = parseId(req.query.trip_id);

  try {
    if (tripId && userId) {
      const membership = await requireMembership(sql, res, tripId, userId);
      if (!membership) return;
    }

    // Headline stats are scoped to the active trip; the overall_* figures span
    // every trip this drink has been rated on, which is the payoff of a shared
    // catalogue — you can see how a drink did last holiday too.
    const [drink] = await sql`
      SELECT
        d.id, d.name, d.category, d.type, d.varietal, d.style, d.source, d.image,
        d.trip_id, d.created_at,
        ROUND(AVG(r.stars) FILTER (
          WHERE ${tripId}::int IS NULL OR r.trip_id = ${tripId}
        )::numeric, 2) AS avg_stars,
        COUNT(r.id) FILTER (
          WHERE ${tripId}::int IS NULL OR r.trip_id = ${tripId}
        )::int AS rating_count,
        ROUND(AVG(r.stars)::numeric, 2)  AS overall_avg_stars,
        COUNT(r.id)::int                 AS overall_rating_count,
        COUNT(DISTINCT r.trip_id)::int   AS trips_rated_on
      FROM drinks d
      LEFT JOIN ratings r ON r.drink_id = d.id
      WHERE d.id = ${drinkId}
      GROUP BY d.id
    `;

    if (!drink) return res.status(404).json({ error: 'Drink not found' });

    const ratings = await sql`
      SELECT
        r.id, r.stars, r.notes, r.updated_at, r.trip_id,
        t.name AS trip_name,
        u.id AS user_id, u.name AS user_name, u.avatar_colour, u.avatar_image
      FROM ratings r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN trips t ON t.id = r.trip_id
      WHERE r.drink_id = ${drinkId}
        AND (${tripId}::int IS NULL OR r.trip_id = ${tripId})
      ORDER BY r.updated_at DESC
    `;

    let myRating = null;
    if (userId) {
      const [found] = await sql`
        SELECT id, stars, notes, trip_id FROM ratings
        WHERE drink_id = ${drinkId}
          AND user_id = ${userId}
          AND (${tripId}::int IS NULL OR trip_id = ${tripId})
        ORDER BY updated_at DESC
        LIMIT 1
      `;
      myRating = found || null;
    }

    return res.json({ drink, ratings, myRating });
  } catch (err) {
    console.error('GET drink error:', err);
    return res.status(500).json({ error: err.message });
  }
};
