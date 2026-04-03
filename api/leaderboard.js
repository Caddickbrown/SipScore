const { neon } = require('@neondatabase/serverless');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { type = 'social', user_id, category = '' } = req.query;
  const sql = neon(process.env.DATABASE_URL);

  try {
    if (type === 'personal') {
      if (!user_id) {
        return res.status(400).json({ error: 'user_id required for personal leaderboard' });
      }

      const rows = await sql`
        SELECT
          d.id, d.name, d.category, d.type, d.varietal, d.style, d.source,
          r.stars AS my_stars, r.notes, r.updated_at,
          ROUND(AVG(r2.stars)::numeric, 1) AS avg_stars,
          COUNT(r2.id) AS rating_count
        FROM ratings r
        JOIN drinks d ON d.id = r.drink_id
        LEFT JOIN ratings r2 ON r2.drink_id = d.id
        WHERE r.user_id = ${parseInt(user_id)}
          AND (${category} = '' OR d.category = ${category})
        GROUP BY d.id, r.stars, r.notes, r.updated_at
        ORDER BY r.stars DESC, r.updated_at DESC
      `;

      return res.json({ leaderboard: rows });

    } else {
      // Social leaderboard — only drinks that have at least one rating
      const rows = await sql`
        SELECT
          d.id, d.name, d.category, d.type, d.varietal, d.style, d.source,
          ROUND(AVG(r.stars)::numeric, 2) AS avg_stars,
          COUNT(r.id) AS rating_count
        FROM drinks d
        JOIN ratings r ON r.drink_id = d.id
        WHERE ${category} = '' OR d.category = ${category}
        GROUP BY d.id
        HAVING COUNT(r.id) > 0
        ORDER BY avg_stars DESC, rating_count DESC, d.name
      `;

      return res.json({ leaderboard: rows });
    }
  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: err.message });
  }
};
