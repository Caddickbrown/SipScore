/* drinks.js — Browse & search drinks */

/* global App */

let user;
let currentCategory = '';
let currentType = '';
let currentScope = 'trip';   // 'trip' — added on this holiday | 'all' — whole catalogue
let autoWidened = false;     // only ever bounce an empty trip to the full list once
let searchTimer;
let requestSeq = 0;          // only the newest search may render (responses can arrive out of order)

// Must match the Type options on the Add/Edit Drink forms (and the iOS app);
// tests/lists.test.js fails if they drift apart.
const CATEGORY_TYPES = {
  wine:      ['White', 'Rosé', 'Red', 'Sparkling', 'Dessert and Fortified'],
  cocktail:  ['Rum-based', 'Vodka-based', 'Gin-based', 'Tequila-based', 'Whiskey-based', 'Wine-based', 'Liqueur-based', 'Mixed', 'Other'],
  beer:      ['Lager', 'Ale', 'IPA', 'Stout', 'Wheat Beer', 'Pilsner', 'Porter', 'Other'],
  cider:     ['Apple', 'Pear (Perry)', 'Fruit', 'Rosé'],
  spirit:    ['Vodka', 'Gin', 'Rum', 'Tequila', 'Whiskey', 'Brandy', 'Ouzo', 'Tsipouro', 'Grappa', 'Liqueur', 'Other'],
  mocktail:  ['Virgin Classic', 'Fruit-based', 'Herbal', 'Sparkling', 'Creamy', 'Other'],
  hotdrink:  ['Espresso', 'Americano', 'Cappuccino', 'Latte', 'Flat White', 'Mocha', 'Greek Coffee', 'Freddo Espresso', 'Freddo Cappuccino', 'Frappé', 'Iced Coffee', 'Cold Brew', 'Black Tea', 'Green Tea', 'Herbal Tea', 'Chai', 'Hot Chocolate', 'Other'],
  softdrink: ['Cola', 'Lemonade', 'Fruit Soda', 'Juice', 'Energy Drink', 'Sparkling Water', 'Iced Tea', 'Other'],
  milkshake: ['Classic', 'Thick Shake', 'Smoothie', 'Other'],
  mead:      ['Traditional', 'Fruit', 'Spiced', 'Sparkling', 'Other'],
  other:     [],
};

// Only ever called with markup built in this file from numbers (stars,
// spinners) — never with text from the server.
function safeHTML(el, html) {
  el.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', () => {
  user = App.requireAuth();
  if (!user) return;

  if (!App.requireTrip()) return;

  App.initNav('drinks');
  App.initTripPill();
  App.initProfileModal();
  setupSearch();
  setupScopeToggle();
  setupCategoryChips();
  loadDrinks();
});

function setupScopeToggle() {
  document.querySelectorAll('#scopeToggle .scope-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.scope === currentScope) return;
      currentScope = btn.dataset.scope;
      autoWidened = true;   // an explicit choice sticks
      renderScopeToggle();
      loadDrinks();
    });
  });
  renderScopeToggle();
}

function renderScopeToggle() {
  document.querySelectorAll('#scopeToggle .scope-btn').forEach(btn => {
    App.setPressed(btn, btn.dataset.scope === currentScope);
  });
}

function setupSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');

  input.addEventListener('input', () => {
    clearBtn.classList.toggle('visible', input.value.length > 0);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadDrinks(), 320);
  });
}

function clearSearch() {
  const input = document.getElementById('searchInput');
  input.value = '';
  document.getElementById('searchClear').classList.remove('visible');
  loadDrinks();
}

function setupCategoryChips() {
  const chips = document.querySelectorAll('#categoryChips .chip');
  chips.forEach(chip => {
    App.setPressed(chip, chip.classList.contains('active'));
    chip.addEventListener('click', () => {
      chips.forEach(c => App.setPressed(c, c === chip));
      currentCategory = chip.dataset.cat;
      currentType = '';
      renderTypeChips();
      loadDrinks();
    });
  });
}

function renderTypeChips() {
  const wrap = document.getElementById('typeChips');
  if (!currentCategory) {
    wrap.style.display = 'none';
    return;
  }

  const types = CATEGORY_TYPES[currentCategory] || [];
  const labels = { wine: 'All Wines', cocktail: 'All Cocktails', beer: 'All Beers', cider: 'All Ciders', spirit: 'All Spirits', mocktail: 'All Mocktails', hotdrink: 'All Coffee & Tea', softdrink: 'All Soft Drinks', milkshake: 'All Milkshakes', mead: 'All Meads', other: 'All Others' };
  const allLabel = labels[currentCategory] || 'All';

  const chips = [
    buildChip('', allLabel, currentType === ''),
    ...types.map(t => buildChip(t, t, currentType === t)),
  ];

  wrap.style.display = 'flex';
  wrap.innerHTML = '';
  chips.forEach(c => wrap.appendChild(c));

  wrap.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      wrap.querySelectorAll('.chip').forEach(c => App.setPressed(c, c === chip));
      currentType = chip.dataset.type;
      loadDrinks();
    });
  });
}

function buildChip(type, label, active) {
  const btn = document.createElement('button');
  btn.className = 'chip';
  App.setPressed(btn, active);
  btn.dataset.type = type;
  btn.textContent = label;
  return btn;
}

async function loadDrinks() {
  const seq = ++requestSeq;
  const search = document.getElementById('searchInput').value.trim();
  const list = document.getElementById('drinksList');
  safeHTML(list, '<div class="loading-wrap"><div class="spinner"></div></div>');

  const params = App.tripParams({
    scope: currentScope,
    search,
    category: currentCategory,
    type: currentType,
  });

  try {
    const data = await App.apiFetch('/api/drinks?' + params.toString());
    if (seq !== requestSeq) return undefined;   // a newer search has started
    const drinks = data.drinks || [];

    // A trip starts with nothing of its own, so rather than showing an empty
    // list, open up the shared catalogue the first time round.
    if (drinks.length === 0 && currentScope === 'trip' && !autoWidened
        && !search && !currentCategory && !currentType) {
      autoWidened = true;
      currentScope = 'all';
      renderScopeToggle();
      return loadDrinks();
    }

    renderDrinks(drinks);
  } catch (err) {
    if (seq === requestSeq) renderError(list, err.message);
  }
  return undefined;
}

function renderDrinks(drinks) {
  const list = document.getElementById('drinksList');
  list.innerHTML = '';

  if (drinks.length === 0) {
    const search = document.getElementById('searchInput').value.trim();
    const trip = App.getTrip();
    const scopeHint = currentScope === 'trip' && trip
      ? `Nothing added on ${trip.name} yet — try "All drinks" or add one.`
      : 'Add a drink to get started!';
    renderEmpty(
      list,
      search ? 'No results' : 'Nothing here yet',
      search ? `No drinks match "${search}"` : scopeHint,
      search ? '/add-drink.html?name=' + encodeURIComponent(search) : null
    );
    return;
  }

  drinks.forEach(d => list.appendChild(drinkCard(d)));
}

function drinkCard(d) {
  const a = document.createElement('a');
  a.className = 'drink-card';
  a.href = '/rate.html?id=' + d.id;

  const accent = document.createElement('div');
  accent.className = 'drink-card-accent ' + App.accentClass(d.category, d.type);

  const body = document.createElement('div');
  body.className = 'drink-card-body';

  // Top row: name + badge
  const top = document.createElement('div');
  top.className = 'drink-card-top';

  const nameEl = document.createElement('div');
  nameEl.className = 'drink-name';
  nameEl.textContent = d.name;

  const badge = document.createElement('span');
  badge.className = 'drink-badge ' + App.badgeClass(d.category, d.type);
  badge.textContent = App.badgeLabel(d.category, d.type);

  top.appendChild(nameEl);
  top.appendChild(badge);

  // Meta
  const meta = document.createElement('div');
  meta.className = 'drink-meta';
  meta.textContent = App.drinkMeta(d);

  // Ratings row
  const ratingsRow = document.createElement('div');
  ratingsRow.className = 'drink-ratings-row';

  const avg = parseFloat(d.avg_stars) || 0;
  const count = parseInt(d.rating_count) || 0;

  const communityWrap = document.createElement('div');
  communityWrap.className = 'community-stars';

  if (count > 0) {
    const starsSpan = document.createElement('span');
    starsSpan.className = 'stars-display';
    safeHTML(starsSpan, App.renderStars(avg));

    const avgSpan = document.createElement('span');
    avgSpan.className = 'rating-avg';
    avgSpan.textContent = avg.toFixed(1);

    const countSpan = document.createElement('span');
    countSpan.className = 'rating-count';
    countSpan.textContent = '(' + count + ')';

    communityWrap.appendChild(starsSpan);
    communityWrap.appendChild(avgSpan);
    communityWrap.appendChild(countSpan);
  } else {
    const noRating = document.createElement('span');
    noRating.className = 'rating-count';
    noRating.textContent = 'No ratings yet';
    communityWrap.appendChild(noRating);
  }

  ratingsRow.appendChild(communityWrap);

  const myStars = parseInt(d.my_stars);
  if (myStars) {
    const myBadge = document.createElement('div');
    myBadge.className = 'my-rating-badge';
    myBadge.innerHTML = '<span class="star-icon">&#9733;</span> You: ' + Number(myStars);
    ratingsRow.appendChild(myBadge);
  }

  body.appendChild(top);
  body.appendChild(meta);
  body.appendChild(ratingsRow);

  const arrow = document.createElement('div');
  arrow.className = 'drink-card-arrow';
  arrow.textContent = '›';

  a.appendChild(accent);
  a.appendChild(body);
  a.appendChild(arrow);

  // Optional thumbnail (the API sends just the first photo)
  const [thumbSrc] = App.parsePhotos(d.image);
  if (thumbSrc) {
    const thumb = document.createElement('div');
    thumb.className = 'drink-card-thumb';
    thumb.appendChild(App.imageEl(thumbSrc, d.name));
    a.appendChild(thumb);
  }

  return a;
}

function renderEmpty(container, title, desc, addUrl) {
  const div = document.createElement('div');
  div.className = 'empty-state';

  const icon = document.createElement('div');
  icon.className = 'empty-state-icon';
  icon.textContent = '●';

  const h3 = document.createElement('h3');
  h3.textContent = title;

  const p = document.createElement('p');
  p.textContent = desc;

  div.appendChild(icon);
  div.appendChild(h3);
  div.appendChild(p);

  if (addUrl) {
    const btn = document.createElement('a');
    btn.className = 'btn btn-primary add-drink-suggestion';
    btn.href = addUrl;
    btn.textContent = 'Add Drink?';
    div.appendChild(btn);
  }

  container.appendChild(div);
}

function renderError(container, msg) {
  const div = document.createElement('div');
  div.className = 'empty-state';

  const h3 = document.createElement('h3');
  h3.textContent = 'Could not load drinks';

  const p = document.createElement('p');
  p.textContent = msg;

  div.appendChild(h3);
  div.appendChild(p);
  container.innerHTML = '';
  container.appendChild(div);
}
