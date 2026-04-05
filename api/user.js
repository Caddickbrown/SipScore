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

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const sql = neon(process.env.DATABASE_URL);

  try {
    const rows = await sql`
      SELECT u.id, u.name, u.avatar_colour, u.avatar_image,
        COUNT(r.id)::int AS rating_count
      FROM users u
      LEFT JOIN ratings r ON r.user_id = u.id
      WHERE u.id = ${parseInt(id)}
      GROUP BY u.id
    `;

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: rows[0] });
  } catch (err) {
    console.error('User profile error:', err);
    return res.status(500).json({ error: err.message });
  }
};
