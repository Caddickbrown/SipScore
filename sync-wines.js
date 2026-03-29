#!/usr/bin/env node
// Syncs wine_list.csv to the database without creating duplicates.
// Matches on (name, category, type, style, source).

require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || null; });
    return row;
  }).filter(row => row.Name);
}

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  const csvPath = path.join(__dirname, 'wine_list.csv');
  const wines = parseCSV(csvPath);

  console.log(`Found ${wines.length} wines in CSV`);

  let inserted = 0;
  let skipped = 0;

  for (const wine of wines) {
    const name = wine.Name;
    const type = wine.Type || null;
    const style = wine.Style || null;
    const source = wine.Source || null;

    const existing = await sql`
      SELECT id FROM drinks
      WHERE name = ${name}
        AND category = 'wine'
        AND (type IS NOT DISTINCT FROM ${type})
        AND (style IS NOT DISTINCT FROM ${style})
        AND (source IS NOT DISTINCT FROM ${source})
      LIMIT 1
    `;

    if (existing.length > 0) {
      console.log(`  SKIP  ${name} (${type})`);
      skipped++;
    } else {
      await sql`
        INSERT INTO drinks (name, category, type, style, source, is_seeded)
        VALUES (${name}, 'wine', ${type}, ${style}, ${source}, true)
      `;
      console.log(`  ADD   ${name} (${type})`);
      inserted++;
    }
  }

  console.log(`\nDone: ${inserted} added, ${skipped} already existed.`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
