/* leaderboard.js — Personal & social leaderboards */

/* global App, DOMPurify */

let user;
let currentTab = 'personal';
let currentCategory = '';

function safeHTML(el, html) {
  el.innerHTML = DOMPurify.sanitize(html);
}

document.addEventListener('DOMContentLoaded', () => {
  user = App.requireAuth();
  if (!user) return;

  App.initNav('leaderboard');
  App.initProfileModal();
  setupCategoryChips();

  const tabParam = new URLSearchParams(window.location.search).get('tab');
  if (tabParam === 'social') switchTab('social');
  else if (tabParam === 'consensus') switchTab('consensus');
  else loadLeaderboard();
});

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tabPersonal').classList.toggle('active', tab === 'personal');
  document.getElementById('tabSocial').classList.toggle('active', tab === 'social');
  document.getElementById('tabConsensus').classList.toggle('active', tab === 'consensus');
  loadLeaderboard();
}

function setupCategoryChips() {
  const chips = document.querySelectorAll('#lbCategoryChips .chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentCategory = chip.dataset.cat;
      loadLeaderboard();
    });
  });
}

async function loadLeaderboard() {
  const list = document.getElementById('leaderboardList');
  safeHTML(list, '<div class="loading-wrap"><div class="spinner"></div></div>');

  const params = new URLSearchParams({ type: currentTab });
  if (currentTab === 'personal') params.set('user_id', user.id);
  if (currentCategory) params.set('category', currentCategory);

  try {
    const data = await App.apiFetch('/api/leaderboard?' + params.toString());
    renderLeaderboard(data.leaderboard || []);
  } catch (err) {
    list.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'empty-state';
    const h3 = document.createElement('h3');
    h3.textContent = 'Could not load rankings';
    const p = document.createElement('p');
    p.textContent = err.message;
    div.appendChild(h3);
    div.appendChild(p);
    list.appendChild(div);
  }
}

function renderLeaderboard(items) {
  const list = document.getElementById('leaderboardList');
  list.innerHTML = '';

  if (items.length === 0) {
    const isPersonal = currentTab === 'personal';
    const isConsensus = currentTab === 'consensus';
    const div = document.createElement('div');
    div.className = 'empty-state';

    const h3 = document.createElement('h3');
    h3.textContent = isPersonal ? 'No ratings yet' : 'No group ratings yet';

    const p = document.createElement('p');
    p.textContent = isPersonal
      ? 'Start rating drinks to build your personal top list!'
      : isConsensus
        ? 'Once the group starts rating, the consensus rankings will appear here.'
        : 'Once the group starts rating, the best drinks will appear here.';

    div.appendChild(h3);
    div.appendChild(p);
    list.appendChild(div);
    return;
  }

  items.forEach((item, i) => list.appendChild(leaderboardItem(item, i + 1)));
}

function leaderboardItem(item, rank) {
  const a = document.createElement('a');
  a.className = 'leaderboard-item';
  a.href = '/rate.html?id=' + item.id + '&from=leaderboard-' + currentTab;

  // Rank badge
  const rankBadge = document.createElement('div');
  const rankClass = rank <= 3 ? 'rank-' + rank : 'rank-other';
  rankBadge.className = 'rank-badge ' + rankClass;
  rankBadge.textContent = rank;

  // Info
  const info = document.createElement('div');
  info.className = 'leaderboard-item-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'lb-drink-name';
  nameEl.textContent = item.name;

  const meta = App.drinkMeta(item);
  const badge = App.badgeLabel(item.category, item.type);
  const metaEl = document.createElement('div');
  metaEl.className = 'lb-drink-meta';
  const typePart = item.category !== 'wine' && item.type ? item.type : '';
  const fullMeta = [typePart, meta].filter(Boolean).join(' \u2022 ');
  metaEl.textContent = badge + (fullMeta ? ' \u2022 ' + fullMeta : '');

  info.appendChild(nameEl);
  info.appendChild(metaEl);

  // Rating
  const ratingWrap = document.createElement('div');
  ratingWrap.className = 'leaderboard-rating';

  const isPersonal = currentTab === 'personal';
  const isConsensus = currentTab === 'consensus';
  const rawScore = isPersonal ? parseInt(item.my_stars) : isConsensus ? parseFloat(item.consensus_score) : parseFloat(item.avg_stars);
  const score = isPersonal ? rawScore : parseFloat(rawScore.toFixed(isConsensus ? 2 : 1));
  const displayScore = isPersonal ? rawScore.toString() : score.toFixed(isConsensus ? 2 : 1);
  const count = parseInt(item.rating_count);

  const scoreEl = document.createElement('div');
  scoreEl.className = 'lb-score';
  if (isConsensus) {
    safeHTML(scoreEl, '<span class="star-icon">&#9733;</span> ' + displayScore);
  } else {
    scoreEl.textContent = displayScore;
  }

  const starsEl = document.createElement('div');
  starsEl.className = 'lb-stars-sm';
  if (!isConsensus) safeHTML(starsEl, App.renderMyStars(Math.round(score)));

  const ratersEl = document.createElement('div');
  ratersEl.className = 'lb-raters';
  ratersEl.textContent = count + ' rating' + (count !== 1 ? 's' : '');

  ratingWrap.appendChild(scoreEl);
  ratingWrap.appendChild(starsEl);
  ratingWrap.appendChild(ratersEl);

  a.appendChild(rankBadge);
  a.appendChild(info);
  a.appendChild(ratingWrap);
  return a;
}
