const {
  withHandler,
  parseId,
  requireMembership,
  getMembership,
} = require('../lib/db');
const { validateDrinkFields, validateDrinkImages } = require('../lib/drinks');

/* -------- GET — drink detail + ratings -------- */
async function handleGet(req, res, sql, drinkId) {
  const userId = parseId(req.query.user_id);
  const tripId = parseId(req.query.trip_id);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });

  if (tripId) {
    const membership = await requireMembership(sql, res, tripId, userId);
    if (!membership) return undefined;
  }

  // Headline stats and the list of reviews cover the active trip, or — with no
  // trip — every trip the viewer is on. The overall_* figures span every trip
  // this drink has been rated on (anonymous aggregates only), which is the
  // payoff of a shared catalogue: you can see how it did last holiday too.
  const [drink] = await sql`
    SELECT
      d.id, d.name, d.category, d.type, d.varietal, d.style, d.source, d.image,
      d.trip_id, d.created_at, d.added_by_user_id,
      ROUND(AVG(r.stars) FILTER (WHERE r.in_scope)::numeric, 2) AS avg_stars,
      COUNT(r.id) FILTER (WHERE r.in_scope)::int                AS rating_count,
      ROUND(AVG(r.stars)::numeric, 2)  AS overall_avg_stars,
      COUNT(r.id)::int                 AS overall_rating_count,
      COUNT(DISTINCT r.trip_id)::int   AS trips_rated_on
    FROM drinks d
    LEFT JOIN (
      SELECT ratings.*,
        CASE WHEN ${tripId}::int IS NOT NULL THEN trip_id = ${tripId}
             ELSE trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = ${userId})
        END AS in_scope
      FROM ratings
    ) r ON r.drink_id = d.id
    WHERE d.id = ${drinkId}
    GROUP BY d.id
  `;

  if (!drink) return res.status(404).json({ error: 'Drink not found' });

  const ratings = await sql`
    SELECT
      r.id, r.stars, r.notes, r.updated_at, r.trip_id,
      t.name AS trip_name,
      u.id AS user_id, u.name AS user_name, u.avatar_colour, u.avatar_image
    FROM ratings r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN trips t ON t.id = r.trip_id
    WHERE r.drink_id = ${drinkId}
      AND CASE WHEN ${tripId}::int IS NOT NULL THEN r.trip_id = ${tripId}
               ELSE r.trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = ${userId})
          END
    ORDER BY r.updated_at DESC
  `;

  const [found] = await sql`
    SELECT id, stars, notes, trip_id FROM ratings
    WHERE drink_id = ${drinkId}
      AND user_id = ${userId}
      AND (${tripId}::int IS NULL OR trip_id = ${tripId})
    ORDER BY updated_at DESC
    LIMIT 1
  `;

  return res.json({ drink, ratings, myRating: found || null });
}

// Anyone on the trip a drink was added on may edit it, as may whoever added it.
// Catalogue drinks with no trip (seeded, or whose trip was deleted) are
// editable by any signed-in user — the catalogue is a shared resource.
async function canEdit(sql, drink, userId) {
  if (!drink.trip_id) return true;
  if (drink.added_by_user_id === userId) return true;
  return Boolean(await getMembership(sql, drink.trip_id, userId));
}

/* -------- PATCH — update drink info and/or photos -------- */
async function handlePatch(req, res, sql, drinkId, body) {
  const userId = parseId(body.user_id);
  if (!userId) return res.status(400).json({ error: 'Please sign in again' });

  const hasImage = Object.prototype.hasOwnProperty.call(body, 'image');
  const hasDetails = body.name !== undefined;
  if (!hasImage && !hasDetails) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  let fields = null;
  if (hasDetails) {
    const checked = validateDrinkFields(body, { requireCategory: false });
    if (checked.error) return res.status(400).json({ error: checked.error });
    fields = checked.fields;
  }

  let image = null;
  if (hasImage) {
    image = validateDrinkImages(body.image);
    if (image.error) return res.status(400).json({ error: image.error });
  }

  const [drink] = await sql`SELECT id, trip_id, added_by_user_id FROM drinks WHERE id = ${drinkId}`;
  if (!drink) return res.status(404).json({ error: 'Drink not found' });
  if (!(await canEdit(sql, drink, userId))) {
    return res.status(403).json({ error: 'Only people on the trip this drink was added on can edit it' });
  }

  if (fields) {
    await sql`
      UPDATE drinks
      SET
        name     = ${fields.name},
        category = COALESCE(${fields.category}, category),
        type     = ${fields.type},
        varietal = ${fields.varietal},
        style    = ${fields.style},
        source   = ${fields.source}
      WHERE id = ${drinkId}
    `;
  }
  if (image) {
    await sql`UPDATE drinks SET image = ${image.value} WHERE id = ${drinkId}`;
  }

  const [updated] = await sql`
    SELECT id, name, category, type, varietal, style, source, image, trip_id
    FROM drinks WHERE id = ${drinkId}
  `;
  return res.json({ drink: updated });
}

module.exports = withHandler(['GET', 'PATCH'], async (req, res, sql, body) => {
  const drinkId = parseId(req.query.id);
  if (!drinkId) return res.status(400).json({ error: 'Invalid drink ID' });

  if (req.method === 'PATCH') return handlePatch(req, res, sql, drinkId, body);
  return handleGet(req, res, sql, drinkId);
});
