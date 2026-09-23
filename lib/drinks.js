/* =============================================
   lib/drinks.js — Validation shared by POST /api/drinks and PATCH /api/drink
   ============================================= */

const { VALID_CATEGORIES, LIMITS, cleanText, validateImages } = require('./db');

// Drinks photos are resized to 800px client-side, so ~300 KB each is ample.
const DRINK_IMAGE_OPTIONS = { maxEach: 400_000, maxCount: 6 };

// Validates the descriptive fields of a drink. Returns { fields } or { error }.
function validateDrinkFields(body, { requireCategory = true } = {}) {
  const name = cleanText(body.name, LIMITS.drinkName, 'Name');
  if (name.error) return { error: name.error };
  if (!name.value || name.value.length < 2) {
    return { error: 'Name must be at least 2 characters' };
  }

  const category = body.category ? String(body.category) : null;
  if (requireCategory && !category) return { error: 'Please pick a category' };
  if (category && !VALID_CATEGORIES.includes(category)) {
    return { error: 'Please pick a valid category' };
  }

  const checks = {
    type: cleanText(body.type, LIMITS.drinkType, 'Type'),
    varietal: cleanText(body.varietal, LIMITS.drinkVarietal, 'Varietal'),
    style: cleanText(body.style, LIMITS.drinkStyle, 'Style'),
    source: cleanText(body.source, LIMITS.drinkSource, 'Origin'),
  };
  for (const check of Object.values(checks)) {
    if (check.error) return { error: check.error };
  }

  return {
    fields: {
      name: name.value,
      category,
      type: checks.type.value,
      varietal: checks.varietal.value,
      style: checks.style.value,
      source: checks.source.value,
    },
  };
}

function validateDrinkImages(value) {
  return validateImages(value, DRINK_IMAGE_OPTIONS);
}

module.exports = { validateDrinkFields, validateDrinkImages };
