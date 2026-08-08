const { getSql, setCors, ensureSchema } = require('../lib/db');

const WINES = [
  { name: 'Pontiglio', type: 'White', style: 'Light and Crisp', source: 'Corfu, Greece' },
  { name: 'Horse Vasiliki Parliarou', type: 'White', style: 'Light and Crisp', source: 'Attiki, Greece' },
  { name: 'Zacharias Winery Synastry', type: 'White', style: 'Light and Crisp', source: 'Peloponnese, Greece' },
  { name: 'Kritikos Boutari Winery', type: 'White', style: 'Light and Crisp', source: 'Crete, Greece' },
  { name: 'Corfiata', type: 'White', style: 'Juicy and Aromatic', source: 'Corfu, Greece' },
  { name: 'Zacharias Winery', type: 'White', style: 'Juicy and Aromatic', source: 'Peloponnese, Greece' },
  { name: 'Ekdosis Proti', type: 'White', style: 'Juicy and Aromatic', source: 'Florina, Greece' },
  { name: 'Estate Petriessa', type: 'White', style: 'Juicy and Aromatic', source: 'Viotia, Greece' },
  { name: 'Ionos Cavino', type: 'White', style: 'Juicy and Aromatic', source: 'Peloponnese, Greece' },
  { name: 'Synastry Zacharias Winery', type: 'White', style: 'Full and Opulent', source: 'Peloponnese, Greece' },
  { name: 'Estate Petriessa', type: 'White', style: 'Full and Opulent', source: 'Evoia, Greece' },
  { name: 'Toso', type: 'White', style: 'Full and Opulent', source: 'Piemonte, Italy' },
  { name: 'Mati Fortuna Astir X', type: 'Rosé', style: 'Light and Crisp', source: 'Peloponnese, Greece' },
  { name: 'Vasiliki Parliarou', type: 'Rosé', style: 'Light and Crisp', source: 'Peloponnese, Greece' },
  { name: 'GR Margetis Greek Wines', type: 'Rosé', style: 'Light and Crisp', source: 'Megara, Greece' },
  { name: 'Kokotos Estate', type: 'Rosé', style: 'Light and Crisp', source: 'Evia, Greece' },
  { name: 'Simeio Stixis Boutari Winery', type: 'Rosé', style: 'Juicy and Aromatic', source: 'Macedonia, Greece' },
  { name: 'Ekdosis Proti', type: 'Rosé', style: 'Juicy and Aromatic', source: 'Florina, Greece' },
  { name: 'Estate Petriessa', type: 'Rosé', style: 'Juicy and Aromatic', source: 'Evoia, Greece' },
  { name: 'Valoninsa', type: 'Rosé', style: 'Juicy and Aromatic', source: 'Corfu, Greece' },
  { name: 'Charites Petres Konstantara Winery', type: 'Rosé', style: 'Juicy and Aromatic', source: 'Chalkidiki, Greece' },
  { name: 'Kritikos Boutari Winery', type: 'Red', style: 'Fruity and Lively', source: 'Crete, Greece' },
  { name: 'Kintonis Estate', type: 'Red', style: 'Fruity and Lively', source: 'Peloponnese, Greece' },
  { name: 'Mavros Kiknos', type: 'Red', style: 'Fruity and Lively', source: 'Peloponnese, Greece' },
  { name: 'Michalakis Estate', type: 'Red', style: 'Fruity and Lively', source: 'Crete, Greece' },
  { name: 'Erochos Argyriou Winery', type: 'Red', style: 'Ripe and Smooth', source: 'Fokida, Greece' },
  { name: 'Captain Red', type: 'Red', style: 'Ripe and Smooth', source: 'Megara, Greece' },
  { name: 'Horse Vasiliki Parliarou', type: 'Red', style: 'Ripe and Smooth', source: 'Peloponnese, Greece' },
  { name: 'Synastry Zacharias Winery', type: 'Red', style: 'Ripe and Smooth', source: 'Peloponnese, Greece' },
  { name: 'Eros & Psyche Argyropoulos Winery', type: 'Red', style: 'Rich and Dense', source: 'Macedonia, Greece' },
  { name: 'Mati Fortuna Astir-X', type: 'Red', style: 'Rich and Dense', source: 'Peloponnese, Greece' },
  { name: 'Estate Petriessa', type: 'Red', style: 'Rich and Dense', source: 'Evoia, Greece' },
  { name: 'Millesimato Brut', type: 'Sparkling', style: null, source: 'Italy' },
  { name: 'Toso', type: 'Sparkling', style: null, source: 'Piemonte, Italy' },
  { name: 'Fiorelli Spumante Toso Rose', type: 'Sparkling', style: null, source: 'Piemonte, Italy' },
  { name: 'Samos Vin Doux EOS Samos', type: 'Dessert and Fortified', style: null, source: 'Samos, Greece' },
  { name: 'Mavrodaphne Deus Patras Cavino', type: 'Dessert and Fortified', style: null, source: 'Peloponnese, Greece' },
];

const COCKTAILS = [
  { name: 'Mojito', type: 'Rum-based', style: 'Refreshing', source: 'Cuba' },
  { name: 'Aperol Spritz', type: 'Wine-based', style: 'Bubbly', source: 'Italy' },
  { name: 'Cosmopolitan', type: 'Vodka-based', style: 'Sweet & Tart', source: 'USA' },
  { name: 'Daiquiri', type: 'Rum-based', style: 'Sour', source: 'Cuba' },
  { name: 'Negroni', type: 'Gin-based', style: 'Bitter', source: 'Italy' },
  { name: 'Espresso Martini', type: 'Vodka-based', style: 'Rich', source: 'UK' },
  { name: 'Pina Colada', type: 'Rum-based', style: 'Tropical', source: 'Puerto Rico' },
  { name: 'Margarita', type: 'Tequila-based', style: 'Sour', source: 'Mexico' },
  { name: 'Sex on the Beach', type: 'Vodka-based', style: 'Sweet', source: 'USA' },
  { name: 'Tequila Sunrise', type: 'Tequila-based', style: 'Sweet', source: 'USA' },
  { name: 'Gin & Tonic', type: 'Gin-based', style: 'Refreshing', source: 'UK' },
  { name: 'Bellini', type: 'Wine-based', style: 'Bubbly', source: 'Italy' },
  { name: 'Kir Royale', type: 'Wine-based', style: 'Bubbly', source: 'France' },
  { name: 'Sangria', type: 'Wine-based', style: 'Fruity', source: 'Spain' },
  { name: 'Long Island Iced Tea', type: 'Mixed', style: 'Strong', source: 'USA' },
  { name: 'Old Fashioned', type: 'Whiskey-based', style: 'Classic', source: 'USA' },
  { name: 'Mai Tai', type: 'Rum-based', style: 'Tropical', source: 'USA' },
  { name: 'Blue Lagoon', type: 'Vodka-based', style: 'Sweet', source: 'International' },
  { name: 'Tom Collins', type: 'Gin-based', style: 'Refreshing', source: 'UK' },
  { name: 'Mimosa', type: 'Wine-based', style: 'Bubbly', source: 'USA' },
];

module.exports = async (req, res) => {
  setCors(res, 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();

  try {
    // Tables, trip columns and the legacy-trip backfill all live in lib/db.
    await ensureSchema(sql);

    // Check if already seeded
    const [{ count }] = await sql`SELECT COUNT(*) as count FROM drinks WHERE is_seeded = true`;
    if (parseInt(count) > 0) {
      return res.json({ success: true, message: 'Already seeded', count: parseInt(count) });
    }

    // Seed wines
    for (const wine of WINES) {
      await sql`
        INSERT INTO drinks (name, category, type, style, source, is_seeded, trip_id)
        VALUES (${wine.name}, 'wine', ${wine.type}, ${wine.style}, ${wine.source}, true, NULL)
      `;
    }

    // Seed cocktails
    for (const cocktail of COCKTAILS) {
      await sql`
        INSERT INTO drinks (name, category, type, style, source, is_seeded, trip_id)
        VALUES (${cocktail.name}, 'cocktail', ${cocktail.type}, ${cocktail.style}, ${cocktail.source}, true, NULL)
      `;
    }

    return res.json({
      success: true,
      message: 'Database seeded successfully',
      wines: WINES.length,
      cocktails: COCKTAILS.length,
    });
  } catch (err) {
    console.error('Seed error:', err);
    return res.status(500).json({ error: err.message });
  }
};
