/* =============================================
   tests/lists.test.js — the drink option lists must agree everywhere
   ---------------------------------------------
   The same lists live in four places: the Add and Edit Drink forms, the
   Drinks page type filters, and the iOS app. When they drift, drinks get
   saved with values nobody can filter to, or a field ends up holding the
   wrong kind of value (cider "Sweetness" once offered Rosé and Sparkling).
   ============================================= */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const { VALID_CATEGORIES } = require('../lib/db');

// FIELD_MAP from drink-form.js: which element holds each category's type and style.
function fieldMap() {
  const src = read('public/js/drink-form.js');
  const map = {};
  for (const m of src.matchAll(/^\s+(\w+):\s+\{ fields: '\w+',\s+type: (null|'(\w+)'),.*?style: (null|'(\w+)')/gm)) {
    map[m[1]] = { type: m[3] || null, style: m[5] || null };
  }
  return map;
}

// Options of a <select id=...>, or data-tag values of a .style-tags container.
function formList(html, id) {
  const select = new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  if (select) return [...select[1].matchAll(/<option value="([^"]+)"/g)].map(m => decode(m[1]));
  const tags = new RegExp(`<div class="style-tags" id="${id}">([\\s\\S]*?)</div>`).exec(html);
  if (tags) return [...tags[1].matchAll(/data-tag="([^"]+)"/g)].map(m => decode(m[1]));
  return null;
}

function drinksFilterTypes() {
  const src = read('public/js/drinks.js');
  const block = /const CATEGORY_TYPES = \{([\s\S]*?)\n\};/.exec(src)[1];
  const out = {};
  for (const m of block.matchAll(/^\s+(\w+):\s+\[(.*?)\],?$/gm)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]);
  }
  return out;
}

function swiftLists(property) {
  const src = read('ios/SipScore/Models/Models.swift');
  const body = new RegExp(`var ${property}: \\[String\\] \\{\\s*switch self \\{([\\s\\S]*?)\\n        \\}\\n    \\}`).exec(src)[1];
  const out = {};
  for (const m of body.matchAll(/case ((?:\.\w+(?:, )?)+):\s+\[([\s\S]*?)\]/g)) {
    const values = [...m[2].matchAll(/"([^"]+)"/g)].map(x => x[1]);
    for (const name of m[1].split(',').map(s => s.trim().slice(1))) out[name] = values;
  }
  return out;
}

const FORMS = ['public/add-drink.html', 'public/edit-drink.html'];
const map = fieldMap();

test('every category has a field mapping, a form section and a form button', () => {
  assert.deepEqual(Object.keys(map).sort(), [...VALID_CATEGORIES].sort());
  for (const form of FORMS) {
    const html = read(form);
    for (const cat of VALID_CATEGORIES) {
      assert.match(html, new RegExp(`data-category="${cat}"`), `${form}: button for ${cat}`);
      assert.match(html, new RegExp(`id="${cat}Fields"`), `${form}: fields for ${cat}`);
    }
  }
});

test('Add and Edit Drink offer exactly the same lists', () => {
  const [add, edit] = FORMS.map(read);
  for (const [cat, ids] of Object.entries(map)) {
    for (const id of [ids.type, ids.style].filter(Boolean)) {
      assert.deepEqual(formList(edit, id), formList(add, id), `${cat} ${id}`);
    }
  }
});

test('the Drinks page can filter by every type the form can save', () => {
  const html = read('public/add-drink.html');
  const filters = drinksFilterTypes();
  for (const [cat, ids] of Object.entries(map)) {
    const formTypes = ids.type ? formList(html, ids.type) : [];
    assert.deepEqual(filters[cat], formTypes, `drinks.js CATEGORY_TYPES.${cat}`);
  }
});

test('the iOS app offers the same types and styles as the web', () => {
  const html = read('public/add-drink.html');
  const types = swiftLists('types');
  const styles = swiftLists('styles');
  for (const [cat, ids] of Object.entries(map)) {
    assert.deepEqual(types[cat], ids.type ? formList(html, ids.type) : [], `iOS types .${cat}`);
    assert.deepEqual(styles[cat], ids.style ? formList(html, ids.style) : [], `iOS styles .${cat}`);
  }
});

test('lists have no duplicates, and a type never doubles as a style', () => {
  const html = read('public/add-drink.html');
  for (const [cat, ids] of Object.entries(map)) {
    const types = ids.type ? formList(html, ids.type) : [];
    const styles = ids.style ? formList(html, ids.style) : [];
    assert.equal(new Set(types).size, types.length, `${cat} types repeat`);
    assert.equal(new Set(styles).size, styles.length, `${cat} styles repeat`);
    const overlap = types.filter(t => styles.includes(t));
    assert.deepEqual(overlap, [], `${cat}: ${overlap.join(', ')} is offered as both type and style`);
  }
});

test('every filter bar lists every category', () => {
  for (const page of ['drinks', 'leaderboard', 'my-reviews', 'user-reviews']) {
    const chips = [...read(`public/${page}.html`).matchAll(/data-cat="([a-z]+)"/g)].map(m => m[1]);
    assert.deepEqual(chips, VALID_CATEGORIES, `${page}.html`);
  }
});
