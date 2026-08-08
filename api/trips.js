const {
  getSql,
  setCors,
  ensureSchema,
  uniqueInviteCode,
  normaliseCode,
  parseId,
  getMembership,
  requireMembership,
} = require('../lib/db');

const MAX_NAME = 100;
const MAX_DESTINATION = 120;

function cleanDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
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

  if (start && end && end < start) {
    return { error: 'End date cannot be before the start date' };
  }

  return { name: trimmedName, destination: trimmedDestination, start_date: start, end_date: end };
}

// Trip rows enriched with the counts the trip switcher shows.
async function tripsForUser(sql, userId) {
  return sql`
    SELECT
      t.id, t.name, t.destination, t.start_date, t.end_date,
      t.invite_code, t.created_by_user_id, t.created_at,
      tm.role,
      (SELECT COUNT(*)::int FROM trip_members m WHERE m.trip_id = t.id)          AS member_count,
      (SELECT COUNT(*)::int FROM drinks d WHERE d.trip_id = t.id)               AS drink_count,
      (SELECT COUNT(*)::int FROM ratings r WHERE r.trip_id = t.id)              AS rating_count,
      (SELECT COUNT(*)::int FROM ratings r
         WHERE r.trip_id = t.id AND r.user_id = ${userId})                      AS my_rating_count
    FROM trips t
    JOIN trip_members tm ON tm.trip_id = t.id AND tm.user_id = ${userId}
    ORDER BY COALESCE(t.start_date, t.created_at::date) DESC, t.id DESC
  `;
}

module.exports = async (req, res) => {
  setCors(res, 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = getSql();

  try {
    await ensureSchema(sql);
  } catch (err) {
    console.error('Trips schema error:', err);
    return res.status(500).json({ error: err.message });
  }

  /* -------- GET -------- */
  if (req.method === 'GET') {
    const userId = parseId(req.query.user_id);
    const code = normaliseCode(req.query.code);
    const tripId = parseId(req.query.id);

    try {
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
        if (!membership) return;

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
    } catch (err) {
      console.error('GET trips error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* -------- POST — create or join -------- */
  if (req.method === 'POST') {
    const { action } = req.body || {};
    const userId = parseId((req.body || {}).user_id);

    if (!userId) return res.status(400).json({ error: 'user_id is required' });

    try {
      if (action === 'join') {
        const code = normaliseCode((req.body || {}).invite_code);
        if (!code) return res.status(400).json({ error: 'An invite code is required' });

        const [trip] = await sql`SELECT id FROM trips WHERE invite_code = ${code}`;
        if (!trip) return res.status(404).json({ error: 'No trip found with that code' });

        await sql`
          INSERT INTO trip_members (trip_id, user_id, role)
          VALUES (${trip.id}, ${userId}, 'member')
          ON CONFLICT (trip_id, user_id) DO NOTHING
        `;

        const [joined] = await tripsForUser(sql, userId).then(rows =>
          rows.filter(t => t.id === trip.id)
        );
        return res.status(201).json({ trip: joined });
      }

      if (action === 'create' || !action) {
        const details = validateDetails(req.body || {});
        if (details.error) return res.status(400).json({ error: details.error });

        const code = await uniqueInviteCode(sql);

        const [trip] = await sql`
          INSERT INTO trips (name, destination, start_date, end_date, invite_code, created_by_user_id)
          VALUES (${details.name}, ${details.destination}, ${details.start_date},
                  ${details.end_date}, ${code}, ${userId})
          RETURNING id
        `;

        await sql`
          INSERT INTO trip_members (trip_id, user_id, role)
          VALUES (${trip.id}, ${userId}, 'owner')
          ON CONFLICT (trip_id, user_id) DO NOTHING
        `;

        const [created] = await tripsForUser(sql, userId).then(rows =>
          rows.filter(t => t.id === trip.id)
        );
        return res.status(201).json({ trip: created });
      }

      return res.status(400).json({ error: 'Invalid action. Use "create" or "join"' });
    } catch (err) {
      console.error('POST trips error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* -------- PATCH — edit trip details (owner only) -------- */
  if (req.method === 'PATCH') {
    const userId = parseId((req.body || {}).user_id);
    const tripId = parseId((req.body || {}).trip_id);

    if (!userId || !tripId) {
      return res.status(400).json({ error: 'user_id and trip_id are required' });
    }

    try {
      const membership = await requireMembership(sql, res, tripId, userId);
      if (!membership) return;
      if (membership.role !== 'owner') {
        return res.status(403).json({ error: 'Only the trip owner can edit it' });
      }

      const details = validateDetails(req.body || {});
      if (details.error) return res.status(400).json({ error: details.error });

      await sql`
        UPDATE trips
        SET name        = ${details.name},
            destination = ${details.destination},
            start_date  = ${details.start_date},
            end_date    = ${details.end_date}
        WHERE id = ${tripId}
      `;

      const [updated] = await tripsForUser(sql, userId).then(rows =>
        rows.filter(t => t.id === tripId)
      );
      return res.json({ trip: updated });
    } catch (err) {
      console.error('PATCH trips error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  /* -------- DELETE — leave, or delete the whole trip -------- */
  if (req.method === 'DELETE') {
    const userId = parseId((req.body || {}).user_id);
    const tripId = parseId((req.body || {}).trip_id);
    const action = (req.body || {}).action || 'leave';

    if (!userId || !tripId) {
      return res.status(400).json({ error: 'user_id and trip_id are required' });
    }

    try {
      const membership = await requireMembership(sql, res, tripId, userId);
      if (!membership) return;

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
            error: 'Hand ownership over or delete the trip before leaving — you are the owner',
          });
        }
        await sql`DELETE FROM trips WHERE id = ${tripId}`;
        return res.json({ success: true, deleted: true });
      }

      await sql`
        DELETE FROM trip_members WHERE trip_id = ${tripId} AND user_id = ${userId}
      `;
      return res.json({ success: true, deleted: false });
    } catch (err) {
      console.error('DELETE trips error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
