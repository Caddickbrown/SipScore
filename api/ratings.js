const {
  withHandler,
  parseId,
  LIMITS,
  cleanText,
  requireMembership,
} = require('../lib/db');

// Clients cached from before trips existed won't send a trip_id. If the user is
// only on one trip there's no ambiguity, so use it rather than failing.
async function resolveTripId(sql, userId, tripId) {
  if (tripId) return tripId;
  const rows = await sql`SELECT trip_id FROM trip_members WHERE user_id = ${userId} LIMIT 2`;
  return rows.length === 1 ? rows[0].trip_id : null;
}

/* -------- POST — upsert a rating -------- */
async function handlePost(req, res, sql, body) {
  const userId = parseId(body.user_id);
  const drinkId = parseId(body.drink_id);
  const stars = Number(body.stars);

  if (!userId || !drinkId || !body.stars) {
    return res.status(400).json({ error: 'user_id, drink_id and stars are required' });
  }
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Stars must be a whole number from 1 to 5' });
  }

  const notes = cleanText(body.notes, LIMITS.ratingNotes, 'Tasting notes');
  if (notes.error) return res.status(400).json({ error: notes.error });

  const tripId = await resolveTripId(sql, userId, parseId(body.trip_id));
  if (!tripId) {
    return res.status(400).json({ error: 'Pick a trip before rating a drink' });
  }

  const membership = await requireMembership(sql, res, tripId, userId);
  if (!membership) return undefined;

  const [drink] = await sql`SELECT id FROM drinks WHERE id = ${drinkId}`;
  if (!drink) return res.status(404).json({ error: 'Drink not found' });

  const [rating] = await sql`
    INSERT INTO ratings (user_id, drink_id, trip_id, stars, notes)
    VALUES (${userId}, ${drinkId}, ${tripId}, ${stars}, ${notes.value})
    ON CONFLICT (user_id, drink_id, trip_id)
    DO UPDATE SET
      stars = EXCLUDED.stars,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING id, user_id, drink_id, trip_id, stars, notes, updated_at
  `;
  return res.json({ rating });
}

/* -------- DELETE — remove a rating -------- */
async function handleDelete(req, res, sql, body) {
  const userId = parseId(body.user_id);
  const drinkId = parseId(body.drink_id);

  if (!userId || !drinkId) {
    return res.status(400).json({ error: 'user_id and drink_id are required' });
  }

  const tripId = await resolveTripId(sql, userId, parseId(body.trip_id));
  if (!tripId) {
    return res.status(400).json({ error: 'Pick a trip before removing a rating' });
  }

  const membership = await requireMembership(sql, res, tripId, userId);
  if (!membership) return undefined;

  await sql`
    DELETE FROM ratings
    WHERE user_id = ${userId} AND drink_id = ${drinkId} AND trip_id = ${tripId}
  `;
  return res.json({ success: true });
}

module.exports = withHandler(['POST', 'DELETE'], async (req, res, sql, body) => {
  if (req.method === 'POST') return handlePost(req, res, sql, body);
  return handleDelete(req, res, sql, body);
});
