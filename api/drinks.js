const {
  withHandler,
  parseId,
  queryString,
  escapeLike,
  requireMembership,
} = require('../lib/db');
const { validateDrinkFields, validateDrinkImages } = require('../lib/drinks');

/* -------- GET — list/search drinks -------- */
async function handleGet(req, res, sql) {
  const search = queryString(req.query.search).trim();
  const category = queryString(req.query.category);
  const type = queryString(req.query.type);
  const scope = queryString(req.query.scope) || 'trip';
  const userId = parseId(req.query.user_id);
  const tripId = parseId(req.query.trip_id);

  // Trip-scoped averages are only for people on that trip.
  if (tripId) {
    if (!userId) return res.status(400).json({ error: 'user_id is required' });
    const membership = await requireMembership(sql, res, tripId, userId);
    if (!membership) return undefined;
  }

  // The catalogue is shared across trips: "trip" shows what was added on this
  // holiday, "all" opens up everything anyone has ever added.
  const tripOnly = scope !== 'all' && Boolean(tripId);
  const pattern = '%' + escapeLike(search) + '%';

  // Lists only need a thumbnail, so ship the first photo and a count rather
  // than up to six full-size images per drink.
  const drinks = await sql`
    SELECT
      d.id, d.name, d.category, d.type, d.varietal, d.style, d.source,
      CASE WHEN d.image LIKE '[%' THEN d.image::jsonb ->> 0 ELSE d.image END AS image,
      CASE
        WHEN d.image IS NULL THEN 0
        WHEN d.image LIKE '[%' THEN jsonb_array_length(d.image::jsonb)
        ELSE 1
      END AS photo_count,
      d.trip_id, d.created_at,
      ROUND(AVG(r.stars) FILTER (
        WHERE ${tripId}::int IS NULL OR r.trip_id = ${tripId}
      )::numeric, 1) AS avg_stars,
      COUNT(r.id) FILTER (
        WHERE ${tripId}::int IS NULL OR r.trip_id = ${tripId}
      )::int AS rating_count,
      ROUND(AVG(r.stars)::numeric, 1) AS overall_avg_stars,
      COUNT(r.id)::int                AS overall_rating_count,
      MAX(r.stars) FILTER (
        WHERE r.user_id = ${userId}
          AND (${tripId}::int IS NULL OR r.trip_id = ${tripId})
      ) AS my_stars
    FROM drinks d
    LEFT JOIN ratings r ON r.drink_id = d.id
    WHERE
      (${search} = '' OR
        d.name ILIKE ${pattern} ESCAPE '\\' OR
        d.category ILIKE ${pattern} ESCAPE '\\' OR
        COALESCE(d.type, '') ILIKE ${pattern} ESCAPE '\\' OR
        COALESCE(d.varietal, '') ILIKE ${pattern} ESCAPE '\\' OR
        COALESCE(d.style, '') ILIKE ${pattern} ESCAPE '\\' OR
        COALESCE(d.source, '') ILIKE ${pattern} ESCAPE '\\'
      )
      AND (${category} = '' OR d.category = ${category})
      AND (${type} = '' OR d.type = ${type})
      AND (${tripOnly} = false OR d.trip_id = ${tripId})
    GROUP BY d.id
    ORDER BY d.name, d.id
  `;

  return res.json({ drinks, scope: tripOnly ? 'trip' : 'all' });
}

/* -------- POST — add a new drink -------- */
async function handlePost(req, res, sql, body) {
  const userId = parseId(body.user_id);
  const tripId = parseId(body.trip_id);
  if (!userId) return res.status(400).json({ error: 'Please sign in again' });

  const checked = validateDrinkFields(body);
  if (checked.error) return res.status(400).json({ error: checked.error });

  const image = validateDrinkImages(body.image);
  if (image.error) return res.status(400).json({ error: image.error });

  // A drink is tagged with the trip it was added on, but stays in the
  // shared catalogue so other trips can find and rate it too.
  if (tripId) {
    const membership = await requireMembership(sql, res, tripId, userId);
    if (!membership) return undefined;
  }

  const f = checked.fields;
  const [drink] = await sql`
    INSERT INTO drinks (name, category, type, varietal, style, source, image, added_by_user_id, trip_id)
    VALUES (${f.name}, ${f.category}, ${f.type}, ${f.varietal},
            ${f.style}, ${f.source}, ${image.value}, ${userId}, ${tripId})
    RETURNING id, name, category, type, varietal, style, source, image, trip_id
  `;
  return res.status(201).json({ drink });
}

module.exports = withHandler(['GET', 'POST'], async (req, res, sql, body) => {
  if (req.method === 'GET') return handleGet(req, res, sql);
  return handlePost(req, res, sql, body);
});
