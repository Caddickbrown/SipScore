/* rate.js — Rate a single drink */

/* global App, DOMPurify */

let user;
let drinkId;
let selectedStars = 0;
let existingRating = null;

function safeHTML(el, html) {
  el.innerHTML = DOMPurify.sanitize(html);
}

document.addEventListener('DOMContentLoaded', async () => {
  user = App.requireAuth();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  drinkId = parseInt(params.get('id'));

  if (!drinkId) {
    window.location.replace('/drinks.html');
    return;
  }

  const from = params.get('from');
  if (from === 'leaderboard-personal' || from === 'leaderboard-social' || from === 'leaderboard-consensus') {
    const backBtn = document.getElementById('backBtn');
    const backLabel = document.getElementById('backLabel');
    const returnUrl = from === 'leaderboard-social'
      ? '/leaderboard.html?tab=social'
      : from === 'leaderboard-consensus'
        ? '/leaderboard.html?tab=consensus'
        : '/leaderboard.html';
    if (backBtn) backBtn.href = returnUrl;
    if (backLabel) backLabel.textContent = 'Rankings';
  }

  setupStars();
  await loadDrink();
});

function setupStars() {
  const container = document.getElementById('starInput');
  const stars = container.querySelectorAll('.star-btn');
  let isTouching = false;

  function selectStar(value) {
    selectedStars = value;
    updateStarUI(selectedStars);
    document.getElementById('saveBtn').disabled = false;
  }

  stars.forEach(btn => {
    btn.addEventListener('touchstart', () => { isTouching = true; }, { passive: true });

    btn.addEventListener('touchend', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      selectStar(parseInt(btn.dataset.val));
      isTouching = false;
    });

    btn.addEventListener('click', () => {
      selectStar(parseInt(btn.dataset.val));
    });

    btn.addEventListener('mouseenter', () => {
      if (!isTouching) updateStarUI(parseInt(btn.dataset.val));
    });

    btn.addEventListener('touchcancel', () => {
      isTouching = false;
      updateStarUI(selectedStars);
    });
  });

  container.addEventListener('mouseleave', () => {
    if (!isTouching) updateStarUI(selectedStars);
    isTouching = false;
  });
}

function updateStarUI(val) {
  const labels = App.STAR_LABELS || ['', 'Poor', 'Fair', 'Good', 'Great', 'Outstanding'];
  document.querySelectorAll('.star-btn').forEach(btn => {
    btn.classList.toggle('lit', parseInt(btn.dataset.val) <= val);
  });
  document.getElementById('starLabel').textContent = val > 0 ? labels[val] : 'Tap a star to rate';
}

async function loadDrink() {
  try {
    const params = new URLSearchParams({
      id: String(drinkId),
      user_id: String(user.id),
    });
    const data = await App.apiFetch('/api/drink?' + params.toString());
    const { drink, ratings, myRating } = data;

    renderHero(drink);
    renderCommunity(drink, ratings);

    if (myRating) {
      existingRating = myRating;
      selectedStars = myRating.stars;
      updateStarUI(selectedStars);
      document.getElementById('notesInput').value = myRating.notes || '';
      document.getElementById('saveBtn').disabled = false;
      document.getElementById('saveBtn').textContent = 'Update Rating';
      document.getElementById('deleteBtn').style.display = 'block';
    }
  } catch (err) {
    document.getElementById('heroTitle').textContent = 'Drink not found';
    App.showToast(err.message, 'error');
  }
}

function renderHero(drink) {
  document.getElementById('heroBadge').textContent = App.badgeLabel(drink.category, drink.type);
  document.getElementById('heroTitle').textContent = drink.name;
  document.getElementById('heroMeta').textContent = App.drinkMeta(drink) || '';
  document.title = 'SipScore \u2014 ' + drink.name;

  const editWrap = document.getElementById('editDrinkWrap');
  const editLink = document.getElementById('editDrinkLink');
  if (editWrap && editLink) {
    editLink.href = '/edit-drink.html?id=' + drink.id;
    editWrap.style.display = 'block';
  }
}

function renderCommunity(drink, ratings) {
  const card = document.getElementById('communityCard');
  const avgRow = document.getElementById('communityAvg');
  const ratingsEl = document.getElementById('communityRatings');

  const avg = parseFloat(drink.avg_stars) || 0;
  const count = parseInt(drink.rating_count) || 0;

  if (count === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  // Average section
  avgRow.innerHTML = '';

  const bigNum = document.createElement('div');
  bigNum.className = 'avg-big-number';
  bigNum.textContent = avg.toFixed(1);

  const details = document.createElement('div');
  details.className = 'avg-details';

  const starsRow = document.createElement('div');
  starsRow.className = 'avg-stars-row';
  safeHTML(starsRow, App.renderStars(avg));

  const countDiv = document.createElement('div');
  countDiv.className = 'avg-count';
  countDiv.textContent = count + ' rating' + (count !== 1 ? 's' : '');

  details.appendChild(starsRow);
  details.appendChild(countDiv);
  avgRow.appendChild(bigNum);
  avgRow.appendChild(details);

  // Individual ratings
  ratingsEl.innerHTML = '';
  ratings.forEach(r => {
    ratingsEl.appendChild(ratingEntryEl(r));
  });
}

function ratingEntryEl(r) {
  const isMe = r.user_id === user.id;
  const initials = App.avatarInitials(r.user_name);

  const entry = document.createElement('div');
  entry.className = 'rating-entry';

  const avatar = document.createElement('div');
  avatar.className = 'rating-entry-avatar';
  avatar.style.background = r.avatar_colour || '#c9a96e';
  avatar.textContent = initials;

  const info = document.createElement('div');
  info.className = 'rating-entry-info';

  const topRow = document.createElement('div');
  topRow.className = 'rating-entry-top';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'rating-entry-name';
  nameSpan.textContent = r.user_name + (isMe ? ' (you)' : '');

  const starsSpan = document.createElement('span');
  starsSpan.className = 'rating-entry-stars';
  safeHTML(starsSpan, App.renderMyStars(r.stars));

  topRow.appendChild(nameSpan);
  topRow.appendChild(starsSpan);
  info.appendChild(topRow);

  if (r.notes) {
    const notes = document.createElement('div');
    notes.className = 'rating-entry-notes';
    notes.textContent = r.notes;
    info.appendChild(notes);
  }

  entry.appendChild(avatar);
  entry.appendChild(info);
  return entry;
}

async function saveRating() {
  if (!selectedStars) return;

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving\u2026';

  try {
    await App.apiFetch('/api/ratings', {
      method: 'POST',
      body: JSON.stringify({
        user_id: user.id,
        drink_id: drinkId,
        stars: selectedStars,
        notes: document.getElementById('notesInput').value.trim() || null,
      }),
    });

    App.showToast('Rating saved!', 'success');
    setTimeout(() => window.location.replace('/rate.html?id=' + drinkId), 800);
  } catch (err) {
    App.showToast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = existingRating ? 'Update Rating' : 'Save Rating';
  }
}

async function deleteRating() {
  if (!confirm('Remove your rating for this drink?')) return;

  try {
    await App.apiFetch('/api/ratings', {
      method: 'DELETE',
      body: JSON.stringify({ user_id: user.id, drink_id: drinkId }),
    });

    App.showToast('Rating removed', 'success');
    setTimeout(() => window.location.replace('/rate.html?id=' + drinkId), 800);
  } catch (err) {
    App.showToast(err.message, 'error');
  }
}
