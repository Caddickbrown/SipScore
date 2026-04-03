/* add-drink.js — Add a new drink */

let user;
let currentCategory = 'wine';

const ALL_CATEGORIES = ['wine', 'cocktail', 'beer', 'cider', 'spirit', 'mocktail', 'hotdrink', 'softdrink', 'milkshake'];

const FIELD_MAP = {
  wine:      { fields: 'wineFields',      type: 'wineType',      varietal: 'wineVarietal', style: 'wineStyle',      source: 'wineSource' },
  cocktail:  { fields: 'cocktailFields',  type: 'cocktailType',  style: 'cocktailStyle',   source: 'cocktailSource' },
  beer:      { fields: 'beerFields',      type: 'beerType',      style: null,              source: 'beerSource' },
  cider:     { fields: 'ciderFields',     type: 'ciderType',     style: null,              source: 'ciderSource' },
  spirit:    { fields: 'spiritFields',    type: 'spiritType',    style: 'spiritStyle',     source: 'spiritSource' },
  mocktail:  { fields: 'mocktailFields',  type: 'mocktailType',  style: 'mocktailStyle',   source: null },
  hotdrink:  { fields: 'hotdrinkFields',  type: 'hotdrinkType',  style: 'hotdrinkStyle',   source: 'hotdrinkSource' },
  softdrink: { fields: 'softdrinkFields', type: 'softdrinkType', style: null,              source: 'softdrinkSource' },
  milkshake: { fields: 'milkshakeFields', type: 'milkshakeType', style: 'milkshakeStyle',  source: null },
};

document.addEventListener('DOMContentLoaded', () => {
  user = App.requireAuth();
  if (!user) return;

  App.initNav('add');
  App.initProfileModal();
});

function setCategory(cat) {
  currentCategory = cat;

  // Update button states
  ALL_CATEGORIES.forEach(c => {
    const btn = document.getElementById('cat' + c.charAt(0).toUpperCase() + c.slice(1));
    if (btn) btn.classList.toggle('active', c === cat);
  });

  // Show/hide field sections
  ALL_CATEGORIES.forEach(c => {
    const el = document.getElementById(FIELD_MAP[c].fields);
    if (el) el.style.display = c === cat ? 'block' : 'none';
  });

  document.getElementById('addError').textContent = '';
}

async function handleAdd(e) {
  e.preventDefault();

  const name = document.getElementById('drinkName').value.trim();
  if (!name) {
    document.getElementById('addError').textContent = 'Please enter a drink name';
    return;
  }

  const map = FIELD_MAP[currentCategory];
  const type     = map.type     ? (document.getElementById(map.type)?.value        || null) : null;
  const varietal = map.varietal ? (document.getElementById(map.varietal)?.value.trim() || null) : null;
  const style    = map.style    ? (document.getElementById(map.style)?.value        || null) : null;
  const source   = map.source   ? (document.getElementById(map.source)?.value.trim() || null) : null;

  const btn = document.getElementById('addBtn');
  btn.disabled = true;
  btn.textContent = 'Adding\u2026';
  document.getElementById('addError').textContent = '';

  try {
    const data = await App.apiFetch('/api/drinks', {
      method: 'POST',
      body: JSON.stringify({
        name,
        category: currentCategory,
        type,
        varietal,
        style,
        source,
        user_id: user.id,
      }),
    });

    App.showToast(name + ' added!', 'success');
    setTimeout(() => {
      window.location.href = '/rate.html?id=' + data.drink.id;
    }, 700);
  } catch (err) {
    document.getElementById('addError').textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Add Drink';
  }
}
