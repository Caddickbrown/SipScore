/* drinks.js — Browse & search drinks */

/* global App, DOMPurify */

let user;
let currentCategory = '';
let currentType = '';
let searchTimer;

const CATEGORY_TYPES = {
  wine:     ['White', 'Rosé', 'Red', 'Sparkling', 'Dessert and Fortified'],
  cocktail: ['Rum-based', 'Vodka-based', 'Gin-based', 'Tequila-based', 'Whiskey-based', 'Wine-based', 'Mixed'],
  beer:     ['Lager', 'Ale', 'Stout', 'IPA', 'Wheat Beer', 'Pilsner', 'Porter'],
  cider:    ['Dry', 'Medium Dry', 'Medium', 'Sweet', 'Rosé', 'Sparkling'],
  spirit:   ['Vodka', 'Gin', 'Rum', 'Tequila', 'Whiskey', 'Brandy', 'Ouzo', 'Grappa'],
  mocktail:  ['Fruit-based', 'Herbal', 'Sparkling', 'Tropical', 'Creamy'],
  coffee:    ['Espresso', 'Latte', 'Cappuccino', 'Flat White', 'Americano', 'Cold Brew', 'Iced Coffee'],
  softdrink: ['Cola', 'Lemonade', 'Juice', 'Energy Drink', 'Sparkling Water', 'Iced Tea'],
  milkshake: ['Classic', 'Smoothie', 'Thick Shake', 'Frappe'],
};

function safeHTML(el, html) {
  el.innerHTML = DOMPurify.sanitize(html);
}

document.addEventListener('DOMContentLoaded', () => {
  user = App.requireAuth();
  if (!user) return;

  App.initNav('drinks');
  App.initProfileModal();
  setupSearch();
  setupCategoryChips();
  loadDrinks();
});

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
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
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
  const labels = { wine: 'All Wines', cocktail: 'All Cocktails', beer: 'All Beers', cider: 'All Ciders', spirit: 'All Spirits', mocktail: 'All Mocktails', coffee: 'All Coffees', softdrink: 'All Soft Drinks', milkshake: 'All Milkshakes' };
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
      wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentType = chip.dataset.type;
      loadDrinks();
    });
  });
}

function buildChip(type, label, active) {
  const btn = document.createElement('button');
  btn.className = 'chip' + (active ? ' active' : '');
  btn.dataset.type = type;
  btn.textContent = label;
  return btn;
}

async function loadDrinks() {
  const search = document.getElementById('searchInput').value.trim();
  const list = document.getElementById('drinksList');
  safeHTML(list, '<div class="loading-wrap"><div class="spinner"></div></div>');

  const params = new URLSearchParams({ user_id: user.id });
  if (search) params.set('search', search);
  if (currentCategory) params.set('category', currentCategory);
  if (currentType) params.set('type', currentType);

  try {
    const data = await App.apiFetch('/api/drinks?' + params.toString());
    renderDrinks(data.drinks || []);
  } catch (err) {
    renderError(list, err.message);
  }
}

function renderDrinks(drinks) {
  const list = document.getElementById('drinksList');
  list.innerHTML = '';

  if (drinks.length === 0) {
    const search = document.getElementById('searchInput').value.trim();
    renderEmpty(
      list,
      search ? 'No results' : 'Nothing here yet',
      search ? `No drinks match "${search}"` : 'Add a drink to get started!'
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
    myBadge.innerHTML = DOMPurify.sanitize('<span class="star-icon">&#9733;</span> You: ' + myStars);
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
  return a;
}

function renderEmpty(container, title, desc) {
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
