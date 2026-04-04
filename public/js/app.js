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
    el.style.background = '';
    el.style.backgroundImage = `url(${user.avatar_image})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
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

function showCropModal(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const cropSize = Math.min(window.innerWidth - 48, 300);

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;touch-action:none;';

      const viewport = document.createElement('div');
      viewport.style.cssText = `width:${cropSize}px;height:${cropSize}px;border-radius:50%;border:2px solid rgba(255,255,255,0.8);overflow:hidden;position:relative;cursor:grab;touch-action:none;flex-shrink:0;`;

      const imgEl = document.createElement('img');
      imgEl.src = url;
      imgEl.draggable = false;
      imgEl.style.cssText = 'position:absolute;user-select:none;-webkit-user-drag:none;touch-action:none;';

      let scale = Math.max(cropSize / img.naturalWidth, cropSize / img.naturalHeight);
      let w = img.naturalWidth * scale;
      let h = img.naturalHeight * scale;
      let x = (cropSize - w) / 2;
      let y = (cropSize - h) / 2;

      const applyTransform = () => {
        imgEl.style.width = w + 'px';
        imgEl.style.height = h + 'px';
        imgEl.style.left = x + 'px';
        imgEl.style.top = y + 'px';
      };
      applyTransform();

      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      const clampPos = (nx, ny, nw, nh) => ({
        x: clamp(nx, cropSize - nw, 0),
        y: clamp(ny, cropSize - nh, 0),
      });

      let dragging = false;
      let startPos = null;
      let startImgPos = null;
      let lastPinchDist = null;

      viewport.addEventListener('mousedown', (e) => {
        dragging = true;
        startPos = { x: e.clientX, y: e.clientY };
        startImgPos = { x, y };
        viewport.style.cursor = 'grabbing';
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const p = clampPos(startImgPos.x + e.clientX - startPos.x, startImgPos.y + e.clientY - startPos.y, w, h);
        x = p.x; y = p.y;
        applyTransform();
      });
      document.addEventListener('mouseup', () => { dragging = false; viewport.style.cursor = 'grab'; });

      viewport.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length === 1) {
          dragging = true;
          startPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          startImgPos = { x, y };
          lastPinchDist = null;
        } else if (e.touches.length === 2) {
          dragging = false;
          lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        }
      }, { passive: false });

      viewport.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length === 1 && dragging) {
          const p = clampPos(startImgPos.x + e.touches[0].clientX - startPos.x, startImgPos.y + e.touches[0].clientY - startPos.y, w, h);
          x = p.x; y = p.y;
          applyTransform();
        } else if (e.touches.length === 2 && lastPinchDist !== null) {
          const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
          const ratio = dist / lastPinchDist;
          lastPinchDist = dist;
          const minScale = Math.max(cropSize / img.naturalWidth, cropSize / img.naturalHeight);
          const newScale = clamp(scale * ratio, minScale, minScale * 4);
          const sr = newScale / scale;
          scale = newScale;
          w = img.naturalWidth * scale;
          h = img.naturalHeight * scale;
          const p = clampPos((cropSize / 2) + (x - cropSize / 2) * sr, (cropSize / 2) + (y - cropSize / 2) * sr, w, h);
          x = p.x; y = p.y;
          applyTransform();
        }
      }, { passive: false });

      viewport.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) lastPinchDist = null;
        if (e.touches.length === 0) dragging = false;
      });

      viewport.appendChild(imgEl);

      const hint = document.createElement('p');
      hint.textContent = 'Drag to reposition · Pinch to zoom';
      hint.style.cssText = 'color:rgba(255,255,255,0.55);font-size:13px;margin:10px 0 0;font-family:inherit;';

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:12px;margin-top:16px;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'padding:10px 28px;border-radius:8px;border:none;background:rgba(255,255,255,0.15);color:white;font-size:15px;cursor:pointer;font-family:inherit;';
      cancelBtn.onclick = () => { document.body.removeChild(overlay); URL.revokeObjectURL(url); reject(new Error('cancelled')); };

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Use Photo';
      confirmBtn.style.cssText = 'padding:10px 28px;border-radius:8px;border:none;background:#c9a96e;color:white;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;';
      confirmBtn.onclick = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, -x / scale, -y / scale, cropSize / scale, cropSize / scale, 0, 0, 100, 100);
        URL.revokeObjectURL(url);
        document.body.removeChild(overlay);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(confirmBtn);
      overlay.appendChild(viewport);
      overlay.appendChild(hint);
      overlay.appendChild(btnRow);
      document.body.appendChild(overlay);
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

      let base64;
      try {
        base64 = await showCropModal(file);
      } catch (err) {
        // User cancelled crop — do nothing
        return;
      }

      if (editBtn) editBtn.classList.add('loading');

      try {
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
