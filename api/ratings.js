const { neon } = require('@neondatabase/serverless');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);

  // POST — upsert a rating
  if (req.method === 'POST') {
    const { user_id, drink_id, stars, notes } = req.body || {};

    if (!user_id || !drink_id || !stars) {
      return res.status(400).json({ error: 'user_id, drink_id and stars are required' });
    }

    const starsNum = parseInt(stars);
    if (starsNum < 1 || starsNum > 5) {
      return res.status(400).json({ error: 'Stars must be between 1 and 5' });
    }

    try {
      const [rating] = await sql`
        INSERT INTO ratings (user_id, drink_id, stars, notes)
        VALUES (${parseInt(user_id)}, ${parseInt(drink_id)}, ${starsNum}, ${notes || null})
        ON CONFLICT (user_id, drink_id)
        DO UPDATE SET
          stars = EXCLUDED.stars,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING id, user_id, drink_id, stars, notes, updated_at
      `;
      return res.json({ rating });
    } catch (err) {
      console.error('POST rating error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — remove a rating
  if (req.method === 'DELETE') {
    const { user_id, drink_id } = req.body || {};

    if (!user_id || !drink_id) {
      return res.status(400).json({ error: 'user_id and drink_id are required' });
    }

    try {
      await sql`
        DELETE FROM ratings
        WHERE user_id = ${parseInt(user_id)} AND drink_id = ${parseInt(drink_id)}
      `;
      return res.json({ success: true });
    } catch (err) {
      console.error('DELETE rating error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
