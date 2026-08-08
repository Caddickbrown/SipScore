const { getSql, setCors, ensureSchema, parseId, requireMembership } = require('../lib/db');

// Clients cached from before trips existed won't send a trip_id. If the user is
// only on one trip there's no ambiguity, so use it rather than failing.
async function resolveTripId(sql, userId, tripId) {
  if (tripId) return tripId;
  const rows = await sql`SELECT trip_id FROM trip_members WHERE user_id = ${userId} LIMIT 2`;
  return rows.length === 1 ? rows[0].trip_id : null;
}

module.exports = async (req, res) => {
  setCors(res, 'POST, DELETE, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = getSql();
  await ensureSchema(sql);

  /* -------- POST — upsert a rating -------- */
  if (req.method === 'POST') {
    const { notes } = req.body || {};
    const userId = parseId((req.body || {}).user_id);
    const drinkId = parseId((req.body || {}).drink_id);
    const stars = parseId((req.body || {}).stars);

    if (!userId || !drinkId || !stars) {
      return res.status(400).json({ error: 'user_id, drink_id and stars are required' });
    }
    if (stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Stars must be between 1 and 5' });
    }

    try {
      const tripId = await resolveTripId(sql, userId, parseId((req.body || {}).trip_id));
      if (!tripId) {
        return res.status(400).json({ error: 'Pick a trip before rating a drink' });
      }

      const membership = await requireMembership(sql, res, tripId, userId);
      if (!membership) return;

      const [rating] = await sql`
        INSERT INTO ratings (user_id, drink_id, trip_id, stars, notes)
        VALUES (${userId}, ${drinkId}, ${tripId}, ${stars}, ${notes || null})
        ON CONFLICT (user_id, drink_id, trip_id)
        DO UPDATE SET
          stars = EXCLUDED.stars,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        RETURNING id, user_id, drink_id, trip_id, stars, notes, updated_at
      `;
      return res.json({ rating });
    } catch (err) {
      console.error('POST rating error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* -------- DELETE — remove a rating -------- */
  if (req.method === 'DELETE') {
    const userId = parseId((req.body || {}).user_id);
    const drinkId = parseId((req.body || {}).drink_id);

    if (!userId || !drinkId) {
      return res.status(400).json({ error: 'user_id and drink_id are required' });
    }

    try {
      const tripId = await resolveTripId(sql, userId, parseId((req.body || {}).trip_id));
      if (!tripId) {
        return res.status(400).json({ error: 'Pick a trip before removing a rating' });
      }

      await sql`
        DELETE FROM ratings
        WHERE user_id = ${userId} AND drink_id = ${drinkId} AND trip_id = ${tripId}
      `;
      return res.json({ success: true });
    } catch (err) {
      console.error('DELETE rating error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
