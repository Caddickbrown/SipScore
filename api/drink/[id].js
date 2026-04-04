const { neon } = require('@neondatabase/serverless');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const { id, user_id } = req.query;
  const drinkId = parseInt(id);

  if (isNaN(drinkId)) {
    return res.status(400).json({ error: 'Invalid drink ID' });
  }

  const sql = neon(process.env.DATABASE_URL);

  // PATCH — update drink info
  if (req.method === 'PATCH') {
    const { name, category, type, varietal, style, source } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const validCategories = ['wine', 'cocktail', 'beer', 'cider', 'spirit', 'mocktail', 'hotdrink', 'softdrink', 'milkshake'];
    if (category && !validCategories.includes(category)) {
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
        RETURNING id, name, category, type, varietal, style, source
      `;

      if (!updated) {
        return res.status(404).json({ error: 'Drink not found' });
      }

      return res.json({ drink: updated });
    } catch (err) {
      console.error('PATCH drink error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    // Get drink details + community stats
    const [drink] = await sql`
      SELECT
        d.id, d.name, d.category, d.type, d.varietal, d.style, d.source, d.created_at,
        ROUND(AVG(r.stars)::numeric, 2) AS avg_stars,
        COUNT(r.id) AS rating_count
      FROM drinks d
      LEFT JOIN ratings r ON r.drink_id = d.id
      WHERE d.id = ${drinkId}
      GROUP BY d.id
    `;

    if (!drink) {
      return res.status(404).json({ error: 'Drink not found' });
    }

    // Get all ratings with user info
    const allRatings = await sql`
      SELECT
        r.id, r.stars, r.notes, r.updated_at,
        u.id AS user_id, u.name AS user_name, u.avatar_colour, u.avatar_image
      FROM ratings r
      JOIN users u ON u.id = r.user_id
      WHERE r.drink_id = ${drinkId}
      ORDER BY r.updated_at DESC
    `;

    // Get current user's rating if user_id provided
    let myRating = null;
    if (user_id) {
      const [found] = await sql`
        SELECT id, stars, notes FROM ratings
        WHERE drink_id = ${drinkId} AND user_id = ${parseInt(user_id)}
      `;
      myRating = found || null;
    }

    return res.json({ drink, ratings: allRatings, myRating });
  } catch (err) {
    console.error('GET drink error:', err);
    return res.status(500).json({ error: err.message });
  }
};
