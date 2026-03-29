const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createClassList() {
  const classes = new Set();
  return {
    toggle(name, force) {
      if (force) classes.add(name);
      else classes.delete(name);
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

function createEventTarget() {
  return {
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] ||= [];
      this.listeners[type].push(listener);
    },
    dispatch(type, event = {}) {
      const listeners = this.listeners[type] || [];
      for (const listener of listeners) listener(event);
    },
  };
}

function loadRateScript() {
  const stars = Array.from({ length: 5 }, (_, index) => {
    const button = createEventTarget();
    button.dataset = { val: String(index + 1) };
    button.classList = createClassList();
    return button;
  });

  const starInput = createEventTarget();
  starInput.querySelectorAll = selector => (selector === '.star-btn' ? stars : []);

  const saveBtn = { disabled: true };
  const starLabel = { textContent: '' };

  const document = {
    addEventListener() {},
    getElementById(id) {
      if (id === 'starInput') return starInput;
      if (id === 'saveBtn') return saveBtn;
      if (id === 'starLabel') return starLabel;
      throw new Error(`Unexpected element requested: ${id}`);
    },
    querySelectorAll(selector) {
      return selector === '.star-btn' ? stars : [];
    },
  };

  const context = {
    document,
    window: {},
    App: {
      STAR_LABELS: ['', 'Poor', 'Fair', 'Good', 'Great', 'Outstanding'],
    },
    DOMPurify: {},
    URLSearchParams,
    parseInt,
    setTimeout,
    clearTimeout,
    console,
  };

  const source = fs.readFileSync(path.join(__dirname, '..', 'public/js/rate.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: 'rate.js' });

  return { context, stars, saveBtn, starLabel };
}

test('app.js and rate.js can be loaded together without redeclaring globals', () => {
  const context = {
    window: {},
    document: { addEventListener() {} },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    URLSearchParams,
    console,
  };

  const appSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
  const rateSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/rate.js'), 'utf8');

  assert.doesNotThrow(() => {
    vm.runInNewContext(appSource, context, { filename: 'app.js' });
    vm.runInNewContext(rateSource, context, { filename: 'rate.js' });
  });
});

test('loadDrink requests the drink endpoint with query parameters', async () => {
  const { context } = loadRateScript();
  let requestedPath = null;

  context.App.apiFetch = async (path) => {
    requestedPath = path;
    return {
      drink: { name: 'Negroni', category: 'cocktail', type: 'Mixed', avg_stars: 0, rating_count: 0 },
      ratings: [],
      myRating: null,
    };
  };
  vm.runInNewContext(`
    user = { id: 42 };
    drinkId = 7;
    renderHero = () => {};
    renderCommunity = () => {};
  `, context);

  await context.loadDrink();

  assert.equal(requestedPath, '/api/drink?id=7&user_id=42');
});

test('touch interaction selects a star rating on mobile', () => {
  const { context, stars, saveBtn, starLabel } = loadRateScript();

  context.setupStars();

  let defaultPrevented = false;
  stars[2].dispatch('touchstart');
  stars[2].dispatch('touchend', {
    preventDefault() {
      defaultPrevented = true;
    },
  });

  assert.equal(defaultPrevented, true);
  assert.equal(saveBtn.disabled, false);
  assert.equal(starLabel.textContent, 'Good');
  assert.equal(stars[0].classList.contains('lit'), true);
  assert.equal(stars[1].classList.contains('lit'), true);
  assert.equal(stars[2].classList.contains('lit'), true);
  assert.equal(stars[3].classList.contains('lit'), false);
});
