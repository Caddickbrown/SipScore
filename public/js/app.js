/* =============================================
   app.js — Shared utilities for SipScore
   ============================================= */

const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Outstanding'];

// ---- User / Auth ----

function getUser() {
  try {
    const raw = localStorage.getItem('sipscore_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setUser(user) {
  localStorage.setItem('sipscore_user', JSON.stringify(user));
}

function clearUser() {
  localStorage.removeItem('sipscore_user');
}

// Redirect to login if not authenticated.
// Call on every protected page.
function requireAuth() {
  const user = getUser();
  if (!user) {
    window.location.replace('/index.html');
    return null;
  }
  return user;
}

// ---- API ----

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---- Stars ----

function renderStars(avg, size = 'sm') {
  avg = parseFloat(avg) || 0;
  const full = Math.floor(avg);
  const half = avg - full >= 0.5;
  let html = '';
  for (let i = 1; i <= 5; i++) {
    const lit = i <= full || (i === full + 1 && half);
    html += `<span class="star-icon ${lit ? '' : 'empty'}">&#9733;</span>`;
  }
  return html;
}

function renderMyStars(stars) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star-icon ${i <= stars ? '' : 'empty'}">&#9733;</span>`;
  }
  return html;
}

// ---- Category / badge helpers ----

function badgeClass(category, type) {
  if (category === 'cocktail') return 'badge-cocktail';
  if (!type) return 'badge-white';
  const key = type.toLowerCase().replace(/\s+/g, '-').replace(/&.*/, '').trim();
  return `badge-${key}`;
}

function accentClass(category, type) {
  if (category === 'cocktail') return 'accent-cocktail';
  if (!type) return 'accent-white';
  const key = type.toLowerCase().split(' ')[0];
  return `accent-${key}`;
}

function badgeLabel(category, type) {
  if (category === 'cocktail') return 'Cocktail';
  return type || 'Wine';
}

function drinkMeta(drink) {
  const parts = [];
  if (drink.style) parts.push(drink.style);
  if (drink.source) parts.push(drink.source);
  return parts.join(' \u2022 ');
}

// ---- Avatar ----

function avatarInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function renderAvatarEl(user, size = 36, cls = 'user-avatar') {
  const initials = avatarInitials(user.name);
  const el = document.createElement('div');
  el.className = cls;
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.background = user.avatar_colour || '#c9a96e';
  el.textContent = initials;
  return el;
}

// ---- Navigation ----

function initNav(activePage) {
  const nav = document.getElementById('bottomNav');
  if (!nav) return;
  const items = nav.querySelectorAll('.nav-item');
  items.forEach(item => {
    if (item.dataset.page === activePage) {
      item.classList.add('active');
    }
  });
}

// ---- Profile modal ----

function initProfileModal() {
  const user = getUser();
  if (!user) return;

  const overlay = document.getElementById('profileModal');
  if (!overlay) return;

  const avatarTrigger = document.getElementById('headerAvatar');
  if (avatarTrigger) {
    avatarTrigger.style.background = user.avatar_colour || '#c9a96e';
    avatarTrigger.textContent = avatarInitials(user.name);
    avatarTrigger.addEventListener('click', () => openProfileModal(user));
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeProfileModal();
  });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearUser();
      window.location.replace('/index.html');
    });
  }
}

function openProfileModal(user) {
  const overlay = document.getElementById('profileModal');
  if (!overlay) return;

  const nameEl = overlay.querySelector('.profile-display-name');
  const statsEl = overlay.querySelector('.profile-stats-text');
  const bigAvatar = overlay.querySelector('.profile-avatar-lg');

  if (nameEl) nameEl.textContent = user.name;
  if (bigAvatar) {
    bigAvatar.textContent = avatarInitials(user.name);
    bigAvatar.style.background = user.avatar_colour || '#c9a96e';
  }
  if (statsEl) {
    apiFetch(`/api/leaderboard?type=personal&user_id=${user.id}`)
      .then(data => {
        const count = data.leaderboard ? data.leaderboard.length : 0;
        statsEl.textContent = `${count} drink${count !== 1 ? 's' : ''} rated`;
      })
      .catch(() => {});
  }

  overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeProfileModal() {
  const overlay = document.getElementById('profileModal');
  if (!overlay) return;
  overlay.classList.remove('visible');
  document.body.style.overflow = '';
}

// ---- Toast ----

let toastTimeout;

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast-${type} visible`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
  }, 2800);
}

// ---- Expose globals ----
window.App = {
  getUser,
  setUser,
  clearUser,
  requireAuth,
  apiFetch,
  renderStars,
  renderMyStars,
  badgeClass,
  accentClass,
  badgeLabel,
  drinkMeta,
  avatarInitials,
  renderAvatarEl,
  initNav,
  initProfileModal,
  openProfileModal,
  closeProfileModal,
  showToast,
  STAR_LABELS,
};
