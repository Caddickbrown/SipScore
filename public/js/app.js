/* =============================================
   app.js — Shared utilities for SipScore
   ============================================= */

// The theme itself is resolved in <head> by /js/theme.js.

const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Outstanding'];

// ---- Safety helpers ----

// Escape text for interpolation into an HTML template string. Prefer
// textContent / createElement; use this where a template is unavoidable.
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// drinks.image / feed_posts.image hold a JSON array of data URLs, or (legacy)
// a single data URL. Returns only well-formed image data URLs.
function parsePhotos(value) {
  if (!value) return [];
  let list;
  if (Array.isArray(value)) list = value;
  else if (String(value).trim().startsWith('[')) {
    try { list = JSON.parse(value); } catch { list = []; }
  } else list = [value];
  if (!Array.isArray(list)) return [];
  return list.filter(src => typeof src === 'string' && /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/i.test(src));
}

function imageEl(src, alt, className) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';
  img.loading = 'lazy';
  if (className) img.className = className;
  return img;
}

// Keeps aria-pressed in step with the visual "active" state of toggle buttons.
function setPressed(el, pressed) {
  el.classList.toggle('active', pressed);
  el.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

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

// ---- Trips ----
// The active trip decides which holiday you're rating on. It's kept in
// localStorage alongside the user so every page picks up the same one.

function getTrip() {
  try {
    const raw = localStorage.getItem('sipscore_trip');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setTrip(trip) {
  if (!trip) return clearTrip();
  localStorage.setItem('sipscore_trip', JSON.stringify(trip));
}

function clearTrip() {
  localStorage.removeItem('sipscore_trip');
}

function getTripId() {
  const trip = getTrip();
  return trip ? trip.id : null;
}

// Redirect to the trips screen if no holiday is selected.
function requireTrip() {
  const trip = getTrip();
  if (!trip) {
    window.location.replace('/trips.html');
    return null;
  }
  return trip;
}

// Query string carrying the signed-in user and the active trip.
function tripParams(extra = {}) {
  const user = getUser();
  const params = new URLSearchParams();
  if (user) params.set('user_id', user.id);
  const tripId = getTripId();
  if (tripId) params.set('trip_id', tripId);
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') params.set(key, value);
  });
  return params;
}

// Body fields for a trip-scoped write.
function tripBody(extra = {}) {
  const user = getUser();
  return { user_id: user ? user.id : null, trip_id: getTripId(), ...extra };
}

// "2026-09-01" (or a timestamp starting with it) as a *local* date. new Date()
// would read a bare date as UTC midnight, which is the previous day west of UTC.
function parseDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isNaN(d) ? null : d;
}

// YYYY-MM-DD for <input type="date">, without a timezone round-trip.
function isoDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || ''));
  return match ? match[1] : '';
}

function formatTripDates(trip) {
  if (!trip || (!trip.start_date && !trip.end_date)) return '';
  const fmt = (value) => {
    const d = parseDateOnly(value);
    if (!d) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const start = trip.start_date ? fmt(trip.start_date) : '';
  const end = trip.end_date ? fmt(trip.end_date) : '';
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

// Header pill showing the current trip; tapping it opens the trip switcher.
function initTripPill() {
  const pill = document.getElementById('tripPill');
  if (!pill) return;
  const trip = getTrip();
  const nameEl = document.getElementById('tripPillName');
  if (nameEl) nameEl.textContent = trip ? trip.name : 'Choose a trip';
  pill.addEventListener('click', () => { window.location.href = '/trips.html'; });
}

// ---- API ----

// Every API route answers JSON, but the platform in front of it may not
// (a 413 for an oversized upload, a 504 timeout), so never assume.
async function apiFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch {
    throw new Error('Could not reach SipScore — check your connection');
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = null; }

  if (!res.ok) {
    if (res.status === 413) throw new Error('Those photos are too large — try fewer or smaller ones');
    const error = new Error((data && data.error) || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  if (data === null) throw new Error('Unexpected response from the server');
  return data;
}

// ---- Stars ----

function renderStars(avg) {
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
  mead:      { badge: 'badge-mead',      accent: 'accent-mead',      label: 'Mead' },
  other:     { badge: 'badge-other',     accent: 'accent-other',     label: 'Other' },
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
  if (drink.style) parts.push(String(drink.style).split(',').map(s => s.trim()).filter(Boolean).join(', '));
  if (drink.source) parts.push(drink.source);
  return parts.join(' \u2022 ');
}

// ---- Avatar ----

function avatarInitials(name) {
  const clean = String(name || '?').trim() || '?';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

function applyAvatarToEl(el, user) {
  const [avatar] = parsePhotos(user.avatar_image);
  if (avatar) {
    el.style.background = '';
    el.style.backgroundImage = `url("${avatar}")`;
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
      const onMouseMove = (e) => {
        if (!dragging) return;
        const p = clampPos(startImgPos.x + e.clientX - startPos.x, startImgPos.y + e.clientY - startPos.y, w, h);
        x = p.x; y = p.y;
        applyTransform();
      };
      const onMouseUp = () => { dragging = false; viewport.style.cursor = 'grab'; };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      const teardown = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        URL.revokeObjectURL(url);
        overlay.remove();
      };

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
      cancelBtn.onclick = () => { teardown(); reject(new Error('cancelled')); };

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Use Photo';
      confirmBtn.style.cssText = 'padding:10px 28px;border-radius:8px;border:none;background:#c9a96e;color:white;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;';
      confirmBtn.onclick = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, -x / scale, -y / scale, cropSize / scale, cropSize / scale, 0, 0, 100, 100);
        teardown();
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

// ---- Theme toggle ----

function currentTheme() {
  return window.SipTheme ? window.SipTheme.current()
    : (document.documentElement.getAttribute('data-theme') || 'light');
}

function refreshThemeIcons() {
  const theme = currentTheme();
  document.querySelectorAll('.theme-toggle-btn, .sidebar-theme-btn').forEach(btn => {
    updateThemeIcon(btn, theme);
  });
}

function toggleTheme() {
  if (window.SipTheme) window.SipTheme.toggle();
  refreshThemeIcons();
}

function updateThemeIcon(btn, theme) {
  if (!btn) return;
  const isDark = theme === 'dark';
  btn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  btn.querySelector('svg').innerHTML = isDark
    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
}

// ---- Sidebar ----

function initSidebar(activePage) {
  const user = getUser();
  const trip = getTrip();
  const sidebar = document.getElementById('sidebarNav');
  if (!sidebar) return;

  sidebar.innerHTML = `
    <a href="/drinks.html" class="sidebar-logo">Sip<span>Score</span></a>
    <div class="sidebar-divider"></div>
    <a href="/drinks.html" class="sidebar-nav-item${activePage === 'drinks' ? ' active' : ''}">
      <svg viewBox="0 0 24 24"><path d="M8 22h8M12 11v11M7 3h10l-2 8H9L7 3z"/></svg>
      Drinks
    </a>
    <a href="/leaderboard.html" class="sidebar-nav-item${activePage === 'leaderboard' ? ' active' : ''}">
      <svg viewBox="0 0 24 24"><path d="M6 9H3l2-5h14l2 5h-3M6 9a6 6 0 0 0 12 0M8 21H5l3-3h8l3 3h-3M12 18v-3"/></svg>
      Rankings
    </a>
    <a href="/feed.html" class="sidebar-nav-item${activePage === 'feed' ? ' active' : ''}">
      <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Feed
    </a>
    <a href="/trips.html" class="sidebar-nav-item${activePage === 'trips' ? ' active' : ''}">
      <svg viewBox="0 0 24 24"><path d="M3 7h18v13H3zM8 7V4h8v3M3 12h18"/></svg>
      Trips
    </a>
    <a href="/add-drink.html" class="sidebar-nav-item${activePage === 'add' ? ' active' : ''}">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
      Add Drink
    </a>
    <div class="sidebar-spacer"></div>
    <button type="button" class="sidebar-trip-pill" id="sidebarTripPill" title="Switch trip">
      <svg viewBox="0 0 24 24"><path d="M3 7h18v13H3zM8 7V4h8v3M3 12h18"/></svg>
      <span class="sidebar-trip-name" id="sidebarTripName"></span>
    </button>
    <button type="button" class="sidebar-theme-btn" id="sidebarThemeBtn">
      <svg viewBox="0 0 24 24"></svg>
      <span id="sidebarThemeLabel">Toggle theme</span>
    </button>
    <div class="sidebar-avatar-row" id="sidebarAvatarRow">
      <div class="user-avatar" id="sidebarAvatar" style="width:30px;height:30px;font-size:0.75rem;"></div>
      <span class="sidebar-avatar-name" id="sidebarAvatarName"></span>
    </div>
  `;

  // Server-provided names go in as text, never as markup.
  sidebar.querySelector('#sidebarTripName').textContent = trip ? trip.name : 'No trip';
  sidebar.querySelector('#sidebarAvatarName').textContent = user ? user.name : '';
  if (user) {
    applyAvatarToEl(sidebar.querySelector('#sidebarAvatar'), user);
  }

  // Trip pill click — reuse the existing trip modal
  const sidebarTripPill = sidebar.querySelector('#sidebarTripPill');
  if (sidebarTripPill) {
    sidebarTripPill.addEventListener('click', () => {
      const mobilePill = document.getElementById('tripPill');
      if (mobilePill) mobilePill.click();
    });
  }

  // Theme toggle
  const themeBtn = sidebar.querySelector('#sidebarThemeBtn');
  if (themeBtn) {
    updateThemeIcon(themeBtn, currentTheme());
    themeBtn.addEventListener('click', toggleTheme);
  }

  // Avatar row — open profile modal
  const avatarRow = sidebar.querySelector('#sidebarAvatarRow');
  if (avatarRow && user) {
    avatarRow.addEventListener('click', () => openProfileModal(user));
  }
}

function initNav(activePage) {
  // Bottom nav (mobile)
  const nav = document.getElementById('bottomNav');
  if (nav) {
    nav.querySelectorAll('.nav-item').forEach(item => {
      if (item.dataset.page === activePage) item.classList.add('active');
    });
  }

  // Sidebar (desktop)
  initSidebar(activePage);

  // Mobile theme toggle in header
  const mobileThemeBtn = document.getElementById('themeToggleBtn');
  if (mobileThemeBtn) {
    updateThemeIcon(mobileThemeBtn, currentTheme());
    mobileThemeBtn.addEventListener('click', toggleTheme);
  }

  // The OS theme can change while the page is open.
  if (window.SipTheme) window.SipTheme.onChange(refreshThemeIcons);
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
      clearTrip();
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
    const trip = getTrip();
    apiFetch('/api/leaderboard?' + tripParams({ type: 'personal' }).toString())
      .then(data => {
        const count = data.leaderboard ? data.leaderboard.length : 0;
        const drinks = `${count} drink${count !== 1 ? 's' : ''} rated`;
        statsEl.textContent = trip ? `${drinks} on ${trip.name}` : drinks;
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
  escapeHtml,
  parsePhotos,
  imageEl,
  setPressed,
  parseDateOnly,
  isoDate,
  getUser,
  setUser,
  clearUser,
  requireAuth,
  getTrip,
  setTrip,
  clearTrip,
  getTripId,
  requireTrip,
  tripParams,
  tripBody,
  formatTripDates,
  initTripPill,
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
  showCropModal,
  initNav,
  initProfileModal,
  openProfileModal,
  closeProfileModal,
  showToast,
  toggleTheme,
  STAR_LABELS,
  CATEGORY_META,
};
