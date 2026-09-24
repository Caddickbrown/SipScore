/* =============================================
   drink-form.js — category switcher and field mapping for the drink form
   Shared by Add Drink and Edit Drink.
   ============================================= */

/* global App, StyleTags */

const DrinkForm = (() => {
  const ALL_CATEGORIES = [
    'wine', 'cocktail', 'beer', 'cider', 'spirit',
    'mocktail', 'hotdrink', 'softdrink', 'milkshake', 'mead', 'other',
  ];

  // Which inputs hold type / varietal / style / source for each category.
  // A style id pointing at a .style-tags container is a multi-select picker.
  const FIELD_MAP = {
    wine:      { fields: 'wineFields',      type: 'wineType',      varietal: 'wineVarietal', style: 'wineStyle',      source: 'wineSource' },
    cocktail:  { fields: 'cocktailFields',  type: 'cocktailType',  varietal: null,           style: 'cocktailStyle',  source: 'cocktailSource' },
    beer:      { fields: 'beerFields',      type: 'beerType',      varietal: null,           style: null,             source: 'beerSource' },
    cider:     { fields: 'ciderFields',     type: 'ciderType',     varietal: null,           style: 'ciderStyle',     source: 'ciderSource' },
    spirit:    { fields: 'spiritFields',    type: 'spiritType',    varietal: null,           style: 'spiritStyle',    source: 'spiritSource' },
    mocktail:  { fields: 'mocktailFields',  type: 'mocktailType',  varietal: null,           style: 'mocktailStyle',  source: null },
    hotdrink:  { fields: 'hotdrinkFields',  type: 'hotdrinkType',  varietal: null,           style: 'hotdrinkStyle',  source: 'hotdrinkSource' },
    softdrink: { fields: 'softdrinkFields', type: 'softdrinkType', varietal: null,           style: null,             source: 'softdrinkSource' },
    milkshake: { fields: 'milkshakeFields', type: 'milkshakeType', varietal: null,           style: 'milkshakeStyle', source: null },
    mead:      { fields: 'meadFields',      type: 'meadType',      varietal: null,           style: 'meadStyle',      source: 'meadSource' },
    other:     { fields: 'otherFields',     type: null,            varietal: null,           style: null,             source: 'otherSource' },
  };

  let category = 'wine';
  let errorEl = null;

  const byId = id => (id ? document.getElementById(id) : null);

  function setError(message) {
    if (errorEl) errorEl.textContent = message || '';
  }

  function setCategory(cat) {
    if (!FIELD_MAP[cat]) return;
    category = cat;
    document.querySelectorAll('.category-btn[data-category]').forEach(btn => {
      App.setPressed(btn, btn.dataset.category === cat);
    });
    ALL_CATEGORIES.forEach(c => {
      const section = byId(FIELD_MAP[c].fields);
      if (section) section.hidden = c !== cat;
    });
    setError('');
  }

  function init({ errorId }) {
    errorEl = byId(errorId);
    document.querySelectorAll('.style-tags').forEach(el => StyleTags.initStyleTags(el.id));
    document.querySelectorAll('.category-btn[data-category]').forEach(btn => {
      btn.addEventListener('click', () => setCategory(btn.dataset.category));
    });
    setCategory(category);
  }

  function isTagPicker(el) {
    return el && el.classList.contains('style-tags');
  }

  function read() {
    const map = FIELD_MAP[category];
    const value = id => {
      const el = byId(id);
      return el && el.value.trim() ? el.value.trim() : null;
    };
    const styleEl = byId(map.style);
    return {
      name: value('drinkName'),
      category,
      type: value(map.type),
      varietal: value(map.varietal),
      style: isTagPicker(styleEl) ? StyleTags.getStyleTags(map.style) : value(map.style),
      source: value(map.source),
    };
  }

  // Selects the stored value. A value that's no longer in the list (retired
  // option, or set from another client) is added as an extra option rather
  // than shown blank — otherwise saving the form would silently erase it.
  function setSelect(id, value) {
    const el = byId(id);
    if (!el || !value) return;
    if (![...el.options].some(opt => opt.value === value)) {
      const extra = document.createElement('option');
      extra.value = value;
      extra.textContent = value;
      extra.dataset.legacy = '1';
      el.appendChild(extra);
    }
    el.value = value;
  }

  function fill(drink) {
    setCategory(FIELD_MAP[drink.category] ? drink.category : 'other');
    const map = FIELD_MAP[category];
    byId('drinkName').value = drink.name || '';
    if (map.type) setSelect(map.type, drink.type);
    if (map.varietal) byId(map.varietal).value = drink.varietal || '';
    if (map.style) {
      if (isTagPicker(byId(map.style))) StyleTags.setStyleTags(map.style, drink.style);
      else setSelect(map.style, drink.style);
    }
    if (map.source) byId(map.source).value = drink.source || '';
  }

  // Mirrors the server's checks so the common mistakes never make a round trip.
  function validate(fields) {
    if (!fields.name) return 'Please enter a drink name';
    if (fields.name.length < 2) return 'Name must be at least 2 characters';
    return null;
  }

  return { init, setCategory, read, fill, validate, setError, get category() { return category; } };
})();

window.DrinkForm = DrinkForm;
