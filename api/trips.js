const {
  withHandler,
  uniqueInviteCode,
  normaliseCode,
  parseId,
  queryString,
  tripsForUser,
  tripForUser,
  getMembership,
  requireMembership,
} = require('../lib/db');

const MAX_NAME = 100;
const MAX_DESTINATION = 120;

// A real calendar date in YYYY-MM-DD form, or null. Rejects 2026-02-31 etc.
function cleanDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return str;
}

function validateDetails({ name, destination, start_date, end_date }) {
  const trimmedName = String(name || '').trim();
  if (trimmedName.length < 2 || trimmedName.length > MAX_NAME) {
    return { error: `Trip name must be 2–${MAX_NAME} characters` };
  }

  const trimmedDestination = String(destination || '').trim().slice(0, MAX_DESTINATION) || null;
  const start = cleanDate(start_date);
  const end = cleanDate(end_date);

  if (start_date && !start) return { error: 'Start date is not a valid date' };
  if (end_date && !end) return { error: 'End date is not a valid date' };
  if (start && end && end < start) {
    return { error: 'End date cannot be before the start date' };
  }

  return { name: trimmedName, destination: trimmedDestination, start_date: start, end_date: end };
}

async function handleGet(req, res, sql) {
  const userId = parseId(req.query.user_id);
  const code = normaliseCode(queryString(req.query.code));
  const tripId = parseId(req.query.id);

  // Look up a trip by invite code — used by the join screen to show what
  // you're about to join before you commit.
  if (code) {
    const [trip] = await sql`
      SELECT
        t.id, t.name, t.destination, t.start_date, t.end_date, t.created_at,
        (SELECT COUNT(*)::int FROM trip_members m WHERE m.trip_id = t.id) AS member_count
      FROM trips t
      WHERE t.invite_code = ${code}
    `;
    if (!trip) return res.status(404).json({ error: 'No trip found with that code' });

    const membership = userId ? await getMembership(sql, trip.id, userId) : null;
    return res.json({ trip: { ...trip, role: membership ? membership.role : null } });
  }

  if (!userId) return res.status(400).json({ error: 'user_id is required' });

  // Single trip, including the member list.
  if (tripId) {
    const membership = await requireMembership(sql, res, tripId, userId);
    if (!membership) return undefined;

    const [trip] = await sql`
      SELECT
        t.id, t.name, t.destination, t.start_date, t.end_date,
        t.invite_code, t.created_by_user_id, t.created_at,
        (SELECT COUNT(*)::int FROM drinks d WHERE d.trip_id = t.id)  AS drink_count,
        (SELECT COUNT(*)::int FROM ratings r WHERE r.trip_id = t.id) AS rating_count
      FROM trips t WHERE t.id = ${tripId}
    `;
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const members = await sql`
      SELECT
        u.id, u.name, u.avatar_colour, u.avatar_image, tm.role, tm.joined_at,
        (SELECT COUNT(*)::int FROM ratings r
           WHERE r.trip_id = ${tripId} AND r.user_id = u.id) AS rating_count
      FROM trip_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.trip_id = ${tripId}
      ORDER BY tm.role = 'owner' DESC, rating_count DESC, u.name
    `;

    return res.json({ trip: { ...trip, role: membership.role }, members });
  }

  const trips = await tripsForUser(sql, userId);
  return res.json({ trips });
}

async function handlePost(req, res, sql, body) {
  const { action } = body;
  const userId = parseId(body.user_id);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });

  if (action === 'join') {
    const code = normaliseCode(body.invite_code);
    if (!code) return res.status(400).json({ error: 'An invite code is required' });

    const [trip] = await sql`SELECT id FROM trips WHERE invite_code = ${code}`;
    if (!trip) return res.status(404).json({ error: 'No trip found with that code' });

    await sql`
      INSERT INTO trip_members (trip_id, user_id, role)
      VALUES (${trip.id}, ${userId}, 'member')
      ON CONFLICT (trip_id, user_id) DO NOTHING
    `;

    return res.status(201).json({ trip: await tripForUser(sql, userId, trip.id) });
  }

  if (action === 'create' || !action) {
    const details = validateDetails(body);
    if (details.error) return res.status(400).json({ error: details.error });

    const code = await uniqueInviteCode(sql);

    // One statement, so a trip can never exist without its owner.
    const [created] = await sql`
      WITH t AS (
        INSERT INTO trips (name, destination, start_date, end_date, invite_code, created_by_user_id)
        VALUES (${details.name}, ${details.destination}, ${details.start_date},
                ${details.end_date}, ${code}, ${userId})
        RETURNING id
      )
      INSERT INTO trip_members (trip_id, user_id, role)
      SELECT id, ${userId}, 'owner' FROM t
      RETURNING trip_id
    `;

    return res.status(201).json({ trip: await tripForUser(sql, userId, created.trip_id) });
  }

  return res.status(400).json({ error: 'Invalid action. Use "create" or "join"' });
}

async function handlePatch(req, res, sql, body) {
  const userId = parseId(body.user_id);
  const tripId = parseId(body.trip_id);
  if (!userId || !tripId) {
    return res.status(400).json({ error: 'user_id and trip_id are required' });
  }

  const membership = await requireMembership(sql, res, tripId, userId);
  if (!membership) return undefined;
  if (membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only the trip owner can edit it' });
  }

  const details = validateDetails(body);
  if (details.error) return res.status(400).json({ error: details.error });

  await sql`
    UPDATE trips
    SET name        = ${details.name},
        destination = ${details.destination},
        start_date  = ${details.start_date},
        end_date    = ${details.end_date}
    WHERE id = ${tripId}
  `;

  return res.json({ trip: await tripForUser(sql, userId, tripId) });
}

async function handleDelete(req, res, sql, body) {
  const userId = parseId(body.user_id);
  const tripId = parseId(body.trip_id);
  const action = body.action || 'leave';

  if (!userId || !tripId) {
    return res.status(400).json({ error: 'user_id and trip_id are required' });
  }

  const membership = await requireMembership(sql, res, tripId, userId);
  if (!membership) return undefined;

  if (action === 'delete') {
    if (membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only the trip owner can delete it' });
    }
    // Ratings and posts cascade; drinks fall back to the shared catalogue.
    await sql`DELETE FROM trips WHERE id = ${tripId}`;
    return res.json({ success: true, deleted: true });
  }

  if (membership.role === 'owner') {
    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM trip_members WHERE trip_id = ${tripId}
    `;
    if (count > 1) {
      return res.status(409).json({
        error: 'The organiser can’t leave a trip others are on. Delete the trip instead.',
      });
    }
    await sql`DELETE FROM trips WHERE id = ${tripId}`;
    return res.json({ success: true, deleted: true });
  }

  await sql`
    DELETE FROM trip_members WHERE trip_id = ${tripId} AND user_id = ${userId}
  `;
  return res.json({ success: true, deleted: false });
}

module.exports = withHandler(['GET', 'POST', 'PATCH', 'DELETE'], async (req, res, sql, body) => {
  if (req.method === 'GET') return handleGet(req, res, sql);
  if (req.method === 'POST') return handlePost(req, res, sql, body);
  if (req.method === 'PATCH') return handlePatch(req, res, sql, body);
  return handleDelete(req, res, sql, body);
});
