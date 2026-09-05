/* edit-drink.js — Edit an existing drink's info */

let user;
let drinkId;
let currentCategory = 'wine';
let pendingPhotos = undefined; // undefined = no change, null = clear all, array = new set

const ALL_CATEGORIES = ['wine', 'cocktail', 'beer', 'cider', 'spirit', 'mocktail', 'hotdrink', 'softdrink', 'milkshake', 'mead', 'other'];

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

function setStyleTags(containerId, value) {
  const container = document.getElementById(containerId);
  if (!container || !value) return;
  const active = new Set(value.split(',').map(s => s.trim()));
  // Activate presets
  container.querySelectorAll('.style-tag').forEach(btn => {
    btn.classList.toggle('active', active.has(btn.dataset.tag));
  });
  // Inject any custom tags not already in the preset list
  const presetTags = new Set([...container.querySelectorAll('.style-tag')].map(b => b.dataset.tag.toLowerCase()));
  const customWrap = container.querySelector('.style-tag-custom');
  active.forEach(tag => {
    if (!tag || presetTags.has(tag.toLowerCase())) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-tag active';
    btn.dataset.tag = tag;
    btn.textContent = tag;
    btn.addEventListener('click', (e) => { e.preventDefault(); btn.classList.toggle('active'); });
    container.insertBefore(btn, customWrap);
  });
}

function getStyleTags(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  const active = [...container.querySelectorAll('.style-tag.active')].map(b => b.dataset.tag);
  return active.length ? active.join(',') : null;
}

const FIELD_MAP = {
  wine:      { fields: 'wineFields',      type: 'wineType',      varietal: 'wineVarietal', style: 'wineStyle',      source: 'wineSource' },
  cocktail:  { fields: 'cocktailFields',  type: 'cocktailType',  varietal: null,           style: 'cocktailStyle',  source: 'cocktailSource' },
  beer:      { fields: 'beerFields',      type: 'beerType',      varietal: null,           style: null,             source: 'beerSource' },
  cider:     { fields: 'ciderFields',     type: 'ciderType',     varietal: null,           style: null,             source: 'ciderSource' },
  spirit:    { fields: 'spiritFields',    type: 'spiritType',    varietal: null,           style: 'spiritStyle',    source: 'spiritSource' },
  mocktail:  { fields: 'mocktailFields',  type: 'mocktailType',  varietal: null,           style: 'mocktailStyle',  source: null },
  hotdrink:  { fields: 'hotdrinkFields',  type: 'hotdrinkType',  varietal: null,           style: 'hotdrinkStyle',  source: 'hotdrinkSource' },
  softdrink: { fields: 'softdrinkFields', type: 'softdrinkType', varietal: null,           style: null,             source: 'softdrinkSource' },
  milkshake: { fields: 'milkshakeFields', type: 'milkshakeType', varietal: null,           style: 'milkshakeStyle', source: null },
  mead:      { fields: 'meadFields',      type: 'meadType',      varietal: null,           style: null,             source: 'meadSource' },
  other:     { fields: 'otherFields',     type: null,            varietal: null,           style: null,             source: 'otherSource' },
};

document.addEventListener('DOMContentLoaded', async () => {
  user = App.requireAuth();
  if (!user) return;

  initStyleTags('wineStyle');
  initStyleTags('cocktailStyle');
  initStyleTags('spiritStyle');
  initStyleTags('mocktailStyle');
  initStyleTags('hotdrinkStyle');
  initStyleTags('milkshakeStyle');

  const params = new URLSearchParams(window.location.search);
  drinkId = parseInt(params.get('id'));

  if (!drinkId) {
    window.location.replace('/drinks.html');
    return;
  }

  // Set up back button to go to the drink's rate page
  const backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.href = '/rate.html?id=' + drinkId;

  await loadDrink();
});

async function loadDrink() {
  try {
    const data = await App.apiFetch('/api/drink?id=' + drinkId + '&user_id=' + user.id);
    const drink = data.drink;

    document.getElementById('heroBadge').textContent = App.badgeLabel(drink.category, drink.type);
    document.getElementById('heroTitle').textContent = drink.name;
    document.title = 'SipScore \u2014 Edit ' + drink.name;

    // Pre-fill the form
    currentCategory = drink.category || 'wine';
    setCategory(currentCategory, false);

    document.getElementById('drinkName').value = drink.name || '';

    const map = FIELD_MAP[currentCategory];

    if (map.type) setSelectValue(map.type, drink.type);
    if (map.varietal) {
      const el = document.getElementById(map.varietal);
      if (el) el.value = drink.varietal || '';
    }
    if (map.style) {
      const el = document.getElementById(map.style);
      if (el && el.classList.contains('style-tags')) {
        setStyleTags(map.style, drink.style);
      } else {
        setSelectValue(map.style, drink.style);
      }
    }
    if (map.source) {
      const el = document.getElementById(map.source);
      if (el) el.value = drink.source || '';
    }

    // Pre-fill existing photos
    if (drink.image) {
      try {
        window._loadedPhotos = JSON.parse(drink.image);
      } catch {
        window._loadedPhotos = [drink.image]; // legacy single image
      }
    } else {
      window._loadedPhotos = [];
    }
    renderPhotoGallery();

    document.getElementById('editForm').style.display = 'block';
  } catch (err) {
    document.getElementById('heroTitle').textContent = 'Drink not found';
    App.showToast(err.message, 'error');
  }
}

function setSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el || !value) return;
  // Try to select the matching option; leave blank if not found
  for (const opt of el.options) {
    if (opt.value === value) {
      el.value = value;
      return;
    }
  }
}

function setCategory(cat, clearFields = true) {
  currentCategory = cat;

  ALL_CATEGORIES.forEach(c => {
    const btn = document.getElementById('cat' + c.charAt(0).toUpperCase() + c.slice(1));
    if (btn) btn.classList.toggle('active', c === cat);

    const el = document.getElementById(FIELD_MAP[c].fields);
    if (el) el.style.display = c === cat ? 'block' : 'none';
  });

  if (clearFields) {
    document.getElementById('editError').textContent = '';
  }
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
  const photos = pendingPhotos !== undefined ? pendingPhotos || [] : window._loadedPhotos || [];
  gallery.innerHTML = '';
  photos.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-gallery-thumb';
    wrap.innerHTML = `<img src="${src}" alt="Photo ${i+1}"><button type="button" class="photo-gallery-remove" aria-label="Remove">×</button>`;
    wrap.querySelector('.photo-gallery-remove').addEventListener('click', () => {
      if (pendingPhotos === undefined) pendingPhotos = [...(window._loadedPhotos || [])];
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

  if (pendingPhotos === undefined) pendingPhotos = [...(window._loadedPhotos || [])];

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

async function handleEdit(e) {
  e.preventDefault();

  const name = document.getElementById('drinkName').value.trim();
  if (!name) {
    document.getElementById('editError').textContent = 'Please enter a drink name';
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

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving\u2026';
  document.getElementById('editError').textContent = '';

  try {
    // Save drink metadata
    await App.apiFetch('/api/drink?id=' + drinkId, {
      method: 'PATCH',
      body: JSON.stringify({ name, category: currentCategory, type, varietal, style, source }),
    });

    // If photos changed, save them separately
    if (pendingPhotos !== undefined) {
      const imageVal = pendingPhotos.length ? JSON.stringify(pendingPhotos) : null;
      await App.apiFetch('/api/drink?id=' + drinkId, {
        method: 'PATCH',
        body: JSON.stringify({ user_id: user.id, image: imageVal }),
      });
    }

    App.showToast('Changes saved!', 'success');
    setTimeout(() => {
      window.location.replace('/rate.html?id=' + drinkId);
    }, 700);
  } catch (err) {
    document.getElementById('editError').textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}
