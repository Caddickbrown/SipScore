const { getSql, setCors, ensureSchema, parseId, requireMembership } = require('../lib/db');

module.exports = async (req, res) => {
  setCors(res, 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { type = 'social', category = '' } = req.query;
  const userId = parseId(req.query.user_id);
  // Omitting trip_id gives the all-time board across every trip.
  const tripId = parseId(req.query.trip_id);

  const sql = getSql();
  await ensureSchema(sql);

  try {
    if (tripId && userId) {
      const membership = await requireMembership(sql, res, tripId, userId);
      if (!membership) return;
    }

    if (type === 'personal') {
      if (!userId) {
        return res.status(400).json({ error: 'user_id required for personal leaderboard' });
      }

      const rows = await sql`
        SELECT
          d.id, d.name, d.category, d.type, d.varietal, d.style, d.source,
          r.stars AS my_stars, r.notes, r.updated_at, r.trip_id,
          t.name AS trip_name,
          ROUND(AVG(r2.stars)::numeric, 1) AS avg_stars,
          COUNT(r2.id)::int AS rating_count
        FROM ratings r
        JOIN drinks d ON d.id = r.drink_id
        LEFT JOIN trips t ON t.id = r.trip_id
        LEFT JOIN ratings r2
          ON r2.drink_id = d.id
         AND (${tripId}::int IS NULL OR r2.trip_id = ${tripId})
        WHERE r.user_id = ${userId}
          AND (${category} = '' OR d.category = ${category})
          AND (${tripId}::int IS NULL OR r.trip_id = ${tripId})
        GROUP BY d.id, r.stars, r.notes, r.updated_at, r.trip_id, t.name
        ORDER BY r.stars DESC, r.updated_at DESC
      `;

      return res.json({ leaderboard: rows });
    }

    if (type === 'consensus') {
      const categoryFilter = category || null;
      const rows = await sql`
        WITH scoped AS (
          SELECT * FROM ratings
          WHERE (${tripId}::int IS NULL OR trip_id = ${tripId})
        ),
        global AS (
          SELECT AVG(stars)::float AS m, 5 AS c FROM scoped
        ),
        drink_stats AS (
          SELECT drink_id, COUNT(*) AS n, SUM(stars)::float AS total_stars
          FROM scoped GROUP BY drink_id
        )
        SELECT d.id, d.name, d.category, d.type, d.varietal, d.style, d.source,
          ds.n::int AS rating_count,
          ROUND((((g.c * g.m) + ds.total_stars) / (g.c + ds.n))::numeric, 2) AS consensus_score
        FROM drinks d
        JOIN drink_stats ds ON d.id = ds.drink_id
        CROSS JOIN global g
        WHERE (${categoryFilter}::text IS NULL OR d.category = ${categoryFilter})
        ORDER BY consensus_score DESC, ds.n DESC
        LIMIT 50
      `;

      return res.json({ leaderboard: rows });
    }

    // Social — only drinks that have at least one rating in scope.
    const rows = await sql`
      SELECT
        d.id, d.name, d.category, d.type, d.varietal, d.style, d.source,
        ROUND(AVG(r.stars)::numeric, 2) AS avg_stars,
        COUNT(r.id)::int AS rating_count
      FROM drinks d
      JOIN ratings r ON r.drink_id = d.id
      WHERE (${category} = '' OR d.category = ${category})
        AND (${tripId}::int IS NULL OR r.trip_id = ${tripId})
      GROUP BY d.id
      HAVING COUNT(r.id) > 0
      ORDER BY avg_stars DESC, rating_count DESC, d.name
    `;

    return res.json({ leaderboard: rows });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: err.message });
  }
};
