/* user-reviews.js — View another user's ratings */

/* global App, DOMPurify */

let currentUser;
let profileUserId;
let currentCategory = '';
let currentSort = 'date';
let allReviews = [];

function safeHTML(el, html) {
  el.innerHTML = DOMPurify.sanitize(html);
}

document.addEventListener('DOMContentLoaded', () => {
  currentUser = App.requireAuth();
  if (!currentUser) return;

  const params = new URLSearchParams(window.location.search);
  profileUserId = parseInt(params.get('user_id'));

  if (!profileUserId) {
    window.location.replace('/drinks.html');
    return;
  }

  // If viewing own profile, redirect to My Reviews
  if (profileUserId === currentUser.id) {
    window.location.replace('/my-reviews.html');
    return;
  }

  App.initNav();
  App.initProfileModal();
  setupCategoryChips();
  setupSort();
  loadUserProfile();
  loadReviews();
});

function setupCategoryChips() {
  const chips = document.querySelectorAll('#categoryChips .chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentCategory = chip.dataset.cat;
      renderReviews();
    });
  });
}

function setupSort() {
  document.getElementById('sortSelect').addEventListener('change', e => {
    currentSort = e.target.value;
    renderReviews();
  });
}

async function loadUserProfile() {
  const nameEl = document.getElementById('userProfileName');
  const statsEl = document.getElementById('userProfileStats');
  const avatarEl = document.getElementById('userProfileAvatar');

  try {
    const data = await App.apiFetch('/api/user?id=' + profileUserId);
    const u = data.user;

    nameEl.textContent = u.name;
    document.title = 'SipScore — ' + u.name + '\u2019s Reviews';
    App.applyAvatarToEl(avatarEl, u);
    statsEl.textContent = u.rating_count + ' drink' + (u.rating_count !== 1 ? 's' : '') + ' rated';
  } catch {
    nameEl.textContent = 'User';
    document.title = 'SipScore — User Reviews';
  }
}

async function loadReviews() {
  const list = document.getElementById('reviewsList');
  safeHTML(list, '<div class="loading-wrap"><div class="spinner"></div></div>');

  try {
    const params = new URLSearchParams({ type: 'personal', user_id: profileUserId });
    const data = await App.apiFetch('/api/leaderboard?' + params.toString());
    allReviews = data.leaderboard || [];
    renderReviews();
  } catch (err) {
    list.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'empty-state';
    const h3 = document.createElement('h3');
    h3.textContent = 'Could not load reviews';
    const p = document.createElement('p');
    p.textContent = err.message;
    div.appendChild(h3);
    div.appendChild(p);
    list.appendChild(div);
  }
}

function filteredAndSorted() {
  let items = allReviews;

  if (currentCategory) {
    items = items.filter(r => r.category === currentCategory);
  }

  items = [...items];
  if (currentSort === 'date') {
    items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  } else if (currentSort === 'stars_desc') {
    items.sort((a, b) => b.my_stars - a.my_stars || new Date(b.updated_at) - new Date(a.updated_at));
  } else if (currentSort === 'stars_asc') {
    items.sort((a, b) => a.my_stars - b.my_stars || new Date(b.updated_at) - new Date(a.updated_at));
  } else if (currentSort === 'name') {
    items.sort((a, b) => a.name.localeCompare(b.name));
  }

  return items;
}

function renderReviews() {
  const list = document.getElementById('reviewsList');
  list.innerHTML = '';

  const items = filteredAndSorted();

  const countEl = document.getElementById('reviewCount');
  countEl.textContent = items.length + ' review' + (items.length !== 1 ? 's' : '');

  if (items.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    const h3 = document.createElement('h3');
    h3.textContent = currentCategory ? 'No ' + currentCategory + ' reviews yet' : 'No reviews yet';
    const p = document.createElement('p');
    p.textContent = 'This user hasn\u2019t rated any drinks yet.';
    div.appendChild(h3);
    div.appendChild(p);
    list.appendChild(div);
    return;
  }

  items.forEach(item => list.appendChild(reviewCard(item)));
}

function reviewCard(item) {
  const a = document.createElement('a');
  a.className = 'review-card';
  a.href = '/rate.html?id=' + item.id;

  // Accent bar
  const accent = document.createElement('div');
  accent.className = 'drink-card-accent ' + App.accentClass(item.category, item.type);

  // Body
  const body = document.createElement('div');
  body.className = 'review-card-body';

  // Top row: name + stars
  const top = document.createElement('div');
  top.className = 'review-card-top';

  const name = document.createElement('div');
  name.className = 'drink-name';
  name.textContent = item.name;

  const starsEl = document.createElement('div');
  starsEl.className = 'review-card-stars';
  safeHTML(starsEl, App.renderMyStars(parseInt(item.my_stars)));

  top.appendChild(name);
  top.appendChild(starsEl);

  // Meta row: badge + source
  const meta = document.createElement('div');
  meta.className = 'review-card-meta';
  const badge = App.badgeLabel(item.category, item.type);
  const drinkMeta = App.drinkMeta(item);
  meta.textContent = badge + (drinkMeta ? ' \u2022 ' + drinkMeta : '');

  body.appendChild(top);
  body.appendChild(meta);

  // Tasting notes
  if (item.notes) {
    const notes = document.createElement('div');
    notes.className = 'review-card-notes';
    notes.textContent = '\u201c' + item.notes + '\u201d';
    body.appendChild(notes);
  }

  // Date
  const date = document.createElement('div');
  date.className = 'review-card-date';
  date.textContent = formatDate(item.updated_at);
  body.appendChild(date);

  a.appendChild(accent);
  a.appendChild(body);
  return a;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
