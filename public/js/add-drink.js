/* add-drink.js — Add a new drink */

let user;
let currentCategory = 'wine';
let pendingPhotos = []; // array of base64 data URLs

const ALL_CATEGORIES = ['wine', 'cocktail', 'beer', 'cider', 'spirit', 'mocktail', 'hotdrink', 'softdrink', 'milkshake', 'mead', 'other'];

const FIELD_MAP = {
  wine:      { fields: 'wineFields',      type: 'wineType',      varietal: 'wineVarietal', style: 'wineStyle',      source: 'wineSource' },
  cocktail:  { fields: 'cocktailFields',  type: 'cocktailType',  style: 'cocktailStyle',   source: 'cocktailSource' },
  beer:      { fields: 'beerFields',      type: 'beerType',      style: null,              source: 'beerSource' },
  cider:     { fields: 'ciderFields',     type: 'ciderType',     style: null,              source: 'ciderSource' },
  spirit:    { fields: 'spiritFields',    type: 'spiritType',    style: 'spiritStyle',     source: 'spiritSource' },
  mocktail:  { fields: 'mocktailFields',  type: 'mocktailType',  style: 'mocktailStyle',   source: null },
  hotdrink:  { fields: 'hotdrinkFields',  type: 'hotdrinkType',  style: 'hotdrinkStyle',   source: 'hotdrinkSource' },
  softdrink: { fields: 'softdrinkFields', type: 'softdrinkType', style: null,              source: 'softdrinkSource' },
  milkshake: { fields: 'milkshakeFields', type: 'milkshakeType', style: 'milkshakeStyle',  source: null },
  mead:      { fields: 'meadFields',      type: 'meadType',      style: null,              source: 'meadSource' },
  other:     { fields: 'otherFields',     type: null,            style: null,              source: 'otherSource' },
};

// ---- Style tag picker ----

function initStyleTags(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.style-tag').forEach(btn => {
    btn.addEventListener('click', (e) => { e.preventDefault(); btn.classList.toggle('active'); });
  });

  // Append custom tag input
  const wrap = document.createElement('div');
  wrap.className = 'style-tag-custom';
  wrap.innerHTML = `<input type="text" class="style-tag-custom-input" placeholder="Custom…" maxlength="40" autocapitalize="words"><button type="button" class="style-tag-custom-btn">+</button>`;
  container.appendChild(wrap);

  const input = wrap.querySelector('.style-tag-custom-input');
  const addBtn = wrap.querySelector('.style-tag-custom-btn');

  function addCustomTag() {
    const val = input.value.trim();
    if (!val) return;
    // Don't duplicate
    const existing = [...container.querySelectorAll('.style-tag')].find(b => b.dataset.tag.toLowerCase() === val.toLowerCase());
    if (existing) {
      existing.classList.add('active');
      input.value = '';
      return;
    }
    const tag = document.createElement('button');
    tag.setAttribute('type', 'button');
    tag.className = 'style-tag active';
    tag.dataset.tag = val;
    tag.textContent = val;
    tag.addEventListener('click', (e) => { e.preventDefault(); tag.classList.toggle('active'); });
    container.insertBefore(tag, wrap);
    input.value = '';
  }

  addBtn.addEventListener('click', (e) => { e.preventDefault(); addCustomTag(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); } });
}

function getStyleTags(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  const active = [...container.querySelectorAll('.style-tag.active')].map(b => b.dataset.tag);
  return active.length ? active.join(',') : null;
}

document.addEventListener('DOMContentLoaded', () => {
  user = App.requireAuth();
  if (!user) return;

  if (!App.requireTrip()) return;

  App.initNav('add');
  App.initTripPill();
  App.initProfileModal();

  initStyleTags('wineStyle');
  initStyleTags('cocktailStyle');
  initStyleTags('spiritStyle');
  initStyleTags('mocktailStyle');
  initStyleTags('hotdrinkStyle');
  initStyleTags('milkshakeStyle');

  const params = new URLSearchParams(window.location.search);
  const prefillName = params.get('name');
  if (prefillName) {
    const nameInput = document.getElementById('drinkName');
    if (nameInput) nameInput.value = prefillName;
  }
});

function setCategory(cat) {
  currentCategory = cat;

  // Update button states
  ALL_CATEGORIES.forEach(c => {
    const btn = document.getElementById('cat' + c.charAt(0).toUpperCase() + c.slice(1));
    if (btn) btn.classList.toggle('active', c === cat);
  });

  // Show/hide field sections
  ALL_CATEGORIES.forEach(c => {
    const el = document.getElementById(FIELD_MAP[c].fields);
    if (el) el.style.display = c === cat ? 'block' : 'none';
  });

  document.getElementById('addError').textContent = '';
}

// ---- Photo handling (multi-image) ----

function resizeDrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      let { width, height } = img;
      if (width > height) {
        if (width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
      } else {
        if (height > MAX) { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

function renderPhotoGallery() {
  const gallery = document.getElementById('photoGallery');
  if (!gallery) return;
  gallery.innerHTML = '';
  pendingPhotos.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-gallery-thumb';
    wrap.innerHTML = `<img src="${src}" alt="Photo ${i+1}"><button type="button" class="photo-gallery-remove" aria-label="Remove">×</button>`;
    wrap.querySelector('.photo-gallery-remove').addEventListener('click', () => {
      pendingPhotos.splice(i, 1);
      renderPhotoGallery();
    });
    gallery.appendChild(wrap);
  });
}

async function handlePhotoSelected(input) {
  const files = Array.from(input.files);
  input.value = '';
  if (!files.length) return;

  for (const file of files) {
    if (pendingPhotos.length >= 6) { App.showToast('Max 6 photos', 'error'); break; }
    try {
      const base64 = await resizeDrinkPhoto(file);
      pendingPhotos.push(base64);
    } catch {
      App.showToast('Could not load a photo', 'error');
    }
  }
  renderPhotoGallery();
}

async function handleAdd(e) {
  e.preventDefault();

  const name = document.getElementById('drinkName').value.trim();
  if (!name) {
    document.getElementById('addError').textContent = 'Please enter a drink name';
    return;
  }

  const map = FIELD_MAP[currentCategory];
  const type     = map.type     ? (document.getElementById(map.type)?.value        || null) : null;
  const varietal = map.varietal ? (document.getElementById(map.varietal)?.value.trim() || null) : null;
  // Wine style uses a tag picker (multi-select); other categories use a plain <select>
  let style = null;
  if (map.style) {
    const el = document.getElementById(map.style);
    if (el && el.classList.contains('style-tags')) {
      style = getStyleTags(map.style);
    } else {
      style = el?.value || null;
    }
  }
  const source   = map.source   ? (document.getElementById(map.source)?.value.trim() || null) : null;

  const btn = document.getElementById('addBtn');
  btn.disabled = true;
  btn.textContent = 'Adding\u2026';
  document.getElementById('addError').textContent = '';

  try {
    const data = await App.apiFetch('/api/drinks', {
      method: 'POST',
      body: JSON.stringify({
        name,
        category: currentCategory,
        type,
        varietal,
        style,
        source,
        image: pendingPhotos.length ? JSON.stringify(pendingPhotos) : null,
        user_id: user.id,
        trip_id: App.getTripId(),
      }),
    });

    App.showToast(name + ' added!', 'success');
    setTimeout(() => {
      window.location.href = '/rate.html?id=' + data.drink.id;
    }, 700);
  } catch (err) {
    document.getElementById('addError').textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Add Drink';
  }
}
