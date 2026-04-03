/* edit-drink.js — Edit an existing drink's info */

let user;
let drinkId;
let currentCategory = 'wine';

const ALL_CATEGORIES = ['wine', 'cocktail', 'beer', 'cider', 'spirit', 'mocktail', 'hotdrink', 'softdrink', 'milkshake'];

const FIELD_MAP = {
  wine:      { fields: 'wineFields',      type: 'wineType',      varietal: 'wineVarietal', style: 'wineStyle',      source: 'wineSource' },
  cocktail:  { fields: 'cocktailFields',  type: 'cocktailType',  varietal: null,           style: 'cocktailStyle',  source: 'cocktailSource' },
  beer:      { fields: 'beerFields',      type: 'beerType',      varietal: null,           style: null,             source: 'beerSource' },
  cider:     { fields: 'ciderFields',     type: 'ciderType',     varietal: null,           style: null,             source: 'ciderSource' },
  spirit:    { fields: 'spiritFields',    type: 'spiritType',    varietal: null,           style: 'spiritStyle',    source: 'spiritSource' },
  mocktail:  { fields: 'mocktailFields',  type: 'mocktailType',  varietal: null,           style: 'mocktailStyle',  source: null },
  hotdrink:  { fields: 'hotdrinkFields',  type: 'hotdrinkType',  varietal: null,           style: 'hotdrinkStyle',  source: 'hotdrinkSource' },
  softdrink: { fields: 'softdrinkFields', type: 'softdrinkType', varietal: null,           style: null,             source: 'softdrinkSource' },
  milkshake: { fields: 'milkshakeFields', type: 'milkshakeType', varietal: null,           style: 'milkshakeStyle', source: null },
};

document.addEventListener('DOMContentLoaded', async () => {
  user = App.requireAuth();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  drinkId = parseInt(params.get('id'));

  if (!drinkId) {
    window.location.replace('/drinks.html');
    return;
  }

  // Set up back button to go to the drink's rate page
  const backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.href = '/rate.html?id=' + drinkId;

  await loadDrink();
});

async function loadDrink() {
  try {
    const data = await App.apiFetch('/api/drink?id=' + drinkId + '&user_id=' + user.id);
    const drink = data.drink;

    document.getElementById('heroBadge').textContent = App.badgeLabel(drink.category, drink.type);
    document.getElementById('heroTitle').textContent = drink.name;
    document.title = 'SipScore \u2014 Edit ' + drink.name;

    // Pre-fill the form
    currentCategory = drink.category || 'wine';
    setCategory(currentCategory, false);

    document.getElementById('drinkName').value = drink.name || '';

    const map = FIELD_MAP[currentCategory];

    if (map.type) setSelectValue(map.type, drink.type);
    if (map.varietal) {
      const el = document.getElementById(map.varietal);
      if (el) el.value = drink.varietal || '';
    }
    if (map.style) setSelectValue(map.style, drink.style);
    if (map.source) {
      const el = document.getElementById(map.source);
      if (el) el.value = drink.source || '';
    }

    document.getElementById('editForm').style.display = 'block';
  } catch (err) {
    document.getElementById('heroTitle').textContent = 'Drink not found';
    App.showToast(err.message, 'error');
  }
}

function setSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el || !value) return;
  // Try to select the matching option; leave blank if not found
  for (const opt of el.options) {
    if (opt.value === value) {
      el.value = value;
      return;
    }
  }
}

function setCategory(cat, clearFields = true) {
  currentCategory = cat;

  ALL_CATEGORIES.forEach(c => {
    const btn = document.getElementById('cat' + c.charAt(0).toUpperCase() + c.slice(1));
    if (btn) btn.classList.toggle('active', c === cat);

    const el = document.getElementById(FIELD_MAP[c].fields);
    if (el) el.style.display = c === cat ? 'block' : 'none';
  });

  if (clearFields) {
    document.getElementById('editError').textContent = '';
  }
}

async function handleEdit(e) {
  e.preventDefault();

  const name = document.getElementById('drinkName').value.trim();
  if (!name) {
    document.getElementById('editError').textContent = 'Please enter a drink name';
    return;
  }

  const map = FIELD_MAP[currentCategory];
  const type     = map.type     ? (document.getElementById(map.type)?.value        || null) : null;
  const varietal = map.varietal ? (document.getElementById(map.varietal)?.value.trim() || null) : null;
  const style    = map.style    ? (document.getElementById(map.style)?.value        || null) : null;
  const source   = map.source   ? (document.getElementById(map.source)?.value.trim() || null) : null;

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving\u2026';
  document.getElementById('editError').textContent = '';

  try {
    await App.apiFetch('/api/drink?id=' + drinkId, {
      method: 'PATCH',
      body: JSON.stringify({ name, category: currentCategory, type, varietal, style, source }),
    });

    App.showToast('Changes saved!', 'success');
    setTimeout(() => {
      window.location.replace('/rate.html?id=' + drinkId);
    }, 700);
  } catch (err) {
    document.getElementById('editError').textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}
