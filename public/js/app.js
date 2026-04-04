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

const CATEGORY_META = {
  wine:     { badge: null,              accent: null,            label: 'Wine' },
  cocktail: { badge: 'badge-cocktail',  accent: 'accent-cocktail', label: 'Cocktail' },
  beer:     { badge: 'badge-beer',      accent: 'accent-beer',   label: 'Beer' },
  cider:    { badge: 'badge-cider',     accent: 'accent-cider',  label: 'Cider' },
  spirit:   { badge: 'badge-spirit',    accent: 'accent-spirit', label: 'Spirit' },
  mocktail:  { badge: 'badge-mocktail',  accent: 'accent-mocktail',  label: 'Mocktail' },
  hotdrink:  { badge: 'badge-hotdrink',  accent: 'accent-hotdrink',  label: 'Hot Drink' },
  softdrink: { badge: 'badge-softdrink', accent: 'accent-softdrink', label: 'Soft Drink' },
  milkshake: { badge: 'badge-milkshake', accent: 'accent-milkshake', label: 'Milkshake' },
};

function badgeClass(category, type) {
  const meta = CATEGORY_META[category];
  if (!meta) return 'badge-white';
  if (meta.badge) return meta.badge;
  // Wine: derive from type
  if (!type) return 'badge-white';
  const key = type.toLowerCase().replace(/\s+/g, '-').replace(/&.*/, '').trim();
  return `badge-${key}`;
}

function accentClass(category, type) {
  const meta = CATEGORY_META[category];
  if (!meta) return 'accent-white';
  if (meta.accent) return meta.accent;
  // Wine: derive from type
  if (!type) return 'accent-white';
  const key = type.toLowerCase().split(' ')[0];
  return `accent-${key}`;
}

function badgeLabel(category, type) {
  const meta = CATEGORY_META[category];
  if (!meta) return type || category;
  if (meta.label !== 'Wine') return meta.label;
  return type || 'Wine';
}

function drinkMeta(drink) {
  const parts = [];
  if (drink.varietal) parts.push(drink.varietal);
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

function applyAvatarToEl(el, user) {
  if (user.avatar_image) {
    el.style.backgroundImage = `url(${user.avatar_image})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.background = '';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.style.background = user.avatar_colour || '#c9a96e';
    el.textContent = avatarInitials(user.name);
  }
}

function renderAvatarEl(user, size = 36, cls = 'user-avatar') {
  const el = document.createElement('div');
  el.className = cls;
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  applyAvatarToEl(el, user);
  return el;
}

function resizeImageToBase64(file, size = 100) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // Square-crop from centre
      const shortest = Math.min(img.width, img.height);
      const sx = (img.width - shortest) / 2;
      const sy = (img.height - shortest) / 2;
      ctx.drawImage(img, sx, sy, shortest, shortest, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
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
    applyAvatarToEl(avatarTrigger, user);
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

  // Avatar upload
  const avatarInput = document.getElementById('avatarInput');
  if (avatarInput) {
    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files[0];
      if (!file) return;
      avatarInput.value = '';

      const editBtn = document.querySelector('.profile-avatar-edit');
      if (editBtn) editBtn.classList.add('loading');

      try {
        const base64 = await resizeImageToBase64(file, 100);
        const { user: updated } = await apiFetch('/api/profile', {
          method: 'PATCH',
          body: JSON.stringify({ user_id: user.id, avatar_image: base64 }),
        });

        const fresh = { ...getUser(), avatar_image: updated.avatar_image };
        setUser(fresh);

        // Update header avatar
        const trigger = document.getElementById('headerAvatar');
        if (trigger) applyAvatarToEl(trigger, fresh);

        // Update big avatar in modal
        const bigAvatar = document.querySelector('.profile-avatar-lg');
        if (bigAvatar) applyAvatarToEl(bigAvatar, fresh);

        showToast('Avatar updated!');
      } catch (err) {
        showToast(err.message || 'Failed to save avatar', 'error');
      } finally {
        if (editBtn) editBtn.classList.remove('loading');
      }
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
  if (bigAvatar) applyAvatarToEl(bigAvatar, user);
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
  applyAvatarToEl,
  renderAvatarEl,
  resizeImageToBase64,
  initNav,
  initProfileModal,
  openProfileModal,
  closeProfileModal,
  showToast,
  STAR_LABELS,
};
