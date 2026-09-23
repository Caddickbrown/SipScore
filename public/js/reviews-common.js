/* =============================================
   reviews-common.js — the filterable, sortable list of one person's ratings
   Shared by My Reviews and User Reviews.
   ============================================= */

/* global App */

function formatReviewDate(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function reviewCard(item) {
  const a = document.createElement('a');
  a.className = 'review-card';
  a.href = '/rate.html?id=' + encodeURIComponent(item.id);

  const accent = document.createElement('div');
  accent.className = 'drink-card-accent ' + App.accentClass(item.category, item.type);

  const body = document.createElement('div');
  body.className = 'review-card-body';

  const top = document.createElement('div');
  top.className = 'review-card-top';

  const name = document.createElement('div');
  name.className = 'drink-name';
  name.textContent = item.name;

  const stars = document.createElement('div');
  stars.className = 'review-card-stars';
  stars.innerHTML = App.renderMyStars(parseInt(item.my_stars, 10) || 0);
  stars.setAttribute('aria-label', `${parseInt(item.my_stars, 10) || 0} out of 5 stars`);

  top.append(name, stars);

  const meta = document.createElement('div');
  meta.className = 'review-card-meta';
  const drinkMeta = App.drinkMeta(item);
  meta.textContent = App.badgeLabel(item.category, item.type) + (drinkMeta ? ' • ' + drinkMeta : '');

  body.append(top, meta);

  if (item.notes) {
    const notes = document.createElement('div');
    notes.className = 'review-card-notes';
    notes.textContent = '“' + item.notes + '”';
    body.appendChild(notes);
  }

  const date = document.createElement('div');
  date.className = 'review-card-date';
  date.textContent = formatReviewDate(item.updated_at);
  body.appendChild(date);

  a.append(accent, body);
  return a;
}

function sortReviews(items, sort) {
  const byDate = (a, b) => new Date(b.updated_at) - new Date(a.updated_at);
  const sorted = [...items];
  if (sort === 'stars_desc') sorted.sort((a, b) => b.my_stars - a.my_stars || byDate(a, b));
  else if (sort === 'stars_asc') sorted.sort((a, b) => a.my_stars - b.my_stars || byDate(a, b));
  else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
  else sorted.sort(byDate);
  return sorted;
}

function emptyState(title, text) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  div.append(h3, p);
  return div;
}

/*
 * Wires up #categoryChips, #sortSelect, #reviewCount and #reviewsList.
 * `load` returns the ratings (leaderboard "personal" rows).
 */
function initReviewList({ load, emptyText }) {
  const list = document.getElementById('reviewsList');
  const countEl = document.getElementById('reviewCount');
  let category = '';
  let sort = 'date';
  let reviews = [];

  function render() {
    const items = sortReviews(
      category ? reviews.filter(r => r.category === category) : reviews,
      sort
    );
    countEl.textContent = items.length + ' review' + (items.length !== 1 ? 's' : '');
    list.replaceChildren();

    if (items.length === 0) {
      const label = category && App.CATEGORY_META[category]
        ? App.CATEGORY_META[category].label.toLowerCase() + ' '
        : '';
      list.appendChild(emptyState(`No ${label}reviews yet`, emptyText));
      return;
    }
    items.forEach(item => list.appendChild(reviewCard(item)));
  }

  const chips = document.querySelectorAll('#categoryChips .chip');
  chips.forEach(chip => {
    App.setPressed(chip, chip.classList.contains('active'));
    chip.addEventListener('click', () => {
      chips.forEach(c => App.setPressed(c, c === chip));
      category = chip.dataset.cat;
      render();
    });
  });

  document.getElementById('sortSelect').addEventListener('change', e => {
    sort = e.target.value;
    render();
  });

  list.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
  load()
    .then(items => { reviews = items || []; render(); })
    .catch(err => {
      list.replaceChildren(emptyState('Could not load reviews', err.message));
    });
}

window.Reviews = { initReviewList };
