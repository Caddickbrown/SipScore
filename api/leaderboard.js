const {
  withHandler,
  parseId,
  queryString,
  requireMembership,
} = require('../lib/db');

// Every board is limited to the active trip, or — when trip_id is omitted —
// to all the trips the viewer is on (the "all-time" view). Nobody sees ratings
// from a trip they aren't part of.
//
// user_id is whose ratings the personal board shows. viewer_id is who is
// looking; it defaults to user_id, and is what membership is checked against,
// so viewing a trip-mate's ratings passes viewer_id = yourself.
module.exports = withHandler(['GET'], async (req, res, sql) => {
  const type = queryString(req.query.type) || 'social';
  const category = queryString(req.query.category);
  const userId = parseId(req.query.user_id);
  const viewerId = parseId(req.query.viewer_id) || userId;
  const tripId = parseId(req.query.trip_id);

  if (!viewerId) return res.status(400).json({ error: 'user_id is required' });

  if (tripId) {
    const membership = await requireMembership(sql, res, tripId, viewerId);
    if (!membership) return undefined;
  }

  if (type === 'personal') {
    if (!userId) {
      return res.status(400).json({ error: 'user_id required for personal leaderboard' });
    }

    const rows = await sql`
      WITH scoped AS (
        SELECT * FROM ratings
        WHERE CASE WHEN ${tripId}::int IS NOT NULL THEN trip_id = ${tripId}
                   ELSE trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = ${viewerId})
              END
      )
      SELECT
        d.id, d.name, d.category, d.type, d.varietal, d.style, d.source,
        r.id AS rating_id, r.stars AS my_stars, r.notes, r.updated_at, r.trip_id,
        t.name AS trip_name,
        (SELECT ROUND(AVG(s.stars)::numeric, 1) FROM scoped s WHERE s.drink_id = d.id) AS avg_stars,
        (SELECT COUNT(*)::int FROM scoped s WHERE s.drink_id = d.id)                   AS rating_count
      FROM scoped r
      JOIN drinks d ON d.id = r.drink_id
      LEFT JOIN trips t ON t.id = r.trip_id
      WHERE r.user_id = ${userId}
        AND (${category} = '' OR d.category = ${category})
      ORDER BY r.stars DESC, r.updated_at DESC, r.id DESC
    `;

    return res.json({ leaderboard: rows });
  }

  if (type === 'consensus') {
    const rows = await sql`
      WITH scoped AS (
        SELECT * FROM ratings
        WHERE CASE WHEN ${tripId}::int IS NOT NULL THEN trip_id = ${tripId}
                   ELSE trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = ${viewerId})
              END
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
      WHERE (${category} = '' OR d.category = ${category})
      ORDER BY consensus_score DESC, ds.n DESC, d.name
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
      AND CASE WHEN ${tripId}::int IS NOT NULL THEN r.trip_id = ${tripId}
               ELSE r.trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = ${viewerId})
          END
    GROUP BY d.id
    ORDER BY avg_stars DESC, rating_count DESC, d.name
  `;

  return res.json({ leaderboard: rows });
});
