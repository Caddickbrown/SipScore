const { getSql, setCors, ensureSchema, parseId } = require('../lib/db');

// PATCH /api/drink-image?id=<drinkId>   { user_id, image }
// Accepts a base64 data URL or null (to remove the image).
// Cap at ~400 KB base64 (~300 KB image) — generous for a drink photo.
const MAX_IMAGE_BYTES = 400_000;

module.exports = async (req, res) => {
  setCors(res, 'PATCH, DELETE, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const drinkId = parseId(req.query.id);
  if (!drinkId) return res.status(400).json({ error: 'Invalid drink ID' });

  const sql = getSql();
  await ensureSchema(sql);

  const { image, user_id } = req.body || {};
  const userId = parseId(user_id);
  if (!userId) return res.status(400).json({ error: 'user_id is required' });

  // DELETE method or image=null → clear the photo
  const newImage = req.method === 'DELETE' ? null : image ?? null;

  if (newImage !== null) {
    if (typeof newImage !== 'string') {
      return res.status(400).json({ error: 'image must be a base64 data URL or null' });
    }
    if (!newImage.startsWith('data:image/')) {
      return res.status(400).json({ error: 'image must be a valid image data URL' });
    }
    if (newImage.length > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: 'Image is too large (max ~300 KB)' });
    }
  }

  try {
    const [updated] = await sql`
      UPDATE drinks
      SET image = ${newImage}
      WHERE id = ${drinkId}
      RETURNING id, image
    `;

    if (!updated) return res.status(404).json({ error: 'Drink not found' });

    return res.json({ drink: updated });
  } catch (err) {
    console.error('PATCH drink-image error:', err);
    return res.status(500).json({ error: err.message });
  }
};
