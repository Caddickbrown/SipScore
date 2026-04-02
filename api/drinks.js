const { neon } = require('@neondatabase/serverless');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);

  // GET — list/search drinks
  if (req.method === 'GET') {
    const { search = '', category = '', type = '', user_id } = req.query;

    try {
      let drinks;

      if (user_id) {
        drinks = await sql`
          SELECT
            d.id, d.name, d.category, d.type, d.varietal, d.style, d.source, d.created_at,
            ROUND(AVG(r.stars)::numeric, 1) AS avg_stars,
            COUNT(r.id) AS rating_count,
            MAX(CASE WHEN r.user_id = ${parseInt(user_id)} THEN r.stars END) AS my_stars
          FROM drinks d
          LEFT JOIN ratings r ON r.drink_id = d.id
          WHERE
            (${search} = '' OR LOWER(d.name) LIKE LOWER(${'%' + search + '%'}))
            AND (${category} = '' OR d.category = ${category})
            AND (${type} = '' OR d.type = ${type})
          GROUP BY d.id
          ORDER BY d.name
        `;
      } else {
        drinks = await sql`
          SELECT
            d.id, d.name, d.category, d.type, d.varietal, d.style, d.source, d.created_at,
            ROUND(AVG(r.stars)::numeric, 1) AS avg_stars,
            COUNT(r.id) AS rating_count
          FROM drinks d
          LEFT JOIN ratings r ON r.drink_id = d.id
          WHERE
            (${search} = '' OR LOWER(d.name) LIKE LOWER(${'%' + search + '%'}))
            AND (${category} = '' OR d.category = ${category})
            AND (${type} = '' OR d.type = ${type})
          GROUP BY d.id
          ORDER BY d.name
        `;
      }

      return res.json({ drinks });
    } catch (err) {
      console.error('GET drinks error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — add a new drink
  if (req.method === 'POST') {
    const { name, category, type, varietal, style, source, user_id } = req.body || {};

    if (!name || !category || !user_id) {
      return res.status(400).json({ error: 'Name, category, and user_id are required' });
    }

    const validCategories = ['wine', 'cocktail', 'beer', 'cider', 'spirit', 'mocktail'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    const trimmedName = String(name).trim();
    if (trimmedName.length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters' });
    }

    try {
      const [drink] = await sql`
        INSERT INTO drinks (name, category, type, varietal, style, source, added_by_user_id)
        VALUES (${trimmedName}, ${category}, ${type || null}, ${varietal || null}, ${style || null}, ${source || null}, ${parseInt(user_id)})
        RETURNING id, name, category, type, varietal, style, source
      `;
      return res.status(201).json({ drink });
    } catch (err) {
      console.error('POST drink error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
