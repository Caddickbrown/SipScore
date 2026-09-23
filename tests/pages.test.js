/* Every page loads its scripts as classic <script>s, which share one global
   scope: two files declaring the same top-level name is a SyntaxError that
   kills the page. Load each page's scripts, in order, into one context. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');

function stubElement() {
  return new Proxy(function () {}, {
    get: (target, prop) => (prop === Symbol.toPrimitive ? () => '' : stubElement()),
    apply: () => stubElement(),
  });
}

for (const page of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html'))) {
  test(`${page}: its scripts load together without clashing`, () => {
    const html = fs.readFileSync(path.join(PUBLIC, page), 'utf8');
    const scripts = [...html.matchAll(/<script src="\/js\/([\w-]+\.js)"><\/script>/g)].map(m => m[1]);
    assert.ok(scripts.includes('theme.js'), 'theme.js is loaded');
    assert.ok(html.indexOf('/js/theme.js') < html.indexOf('/css/style.css'), 'theme.js runs before the stylesheet');

    const document = {
      addEventListener() {},
      documentElement: { setAttribute() {}, getAttribute() { return 'light'; } },
      querySelectorAll: () => [],
      getElementById: () => null,
    };
    const context = vm.createContext({
      window: {}, document, console, URLSearchParams, setTimeout, clearTimeout,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      fetch: async () => ({ ok: true, text: async () => '{}' }),
    });
    context.window = context;
    // Page scripts that run immediately (feed.js) bail out at requireAuth.
    context.location = { replace() {}, href: '', search: '' };

    for (const file of scripts) {
      const source = fs.readFileSync(path.join(PUBLIC, 'js', file), 'utf8');
      assert.doesNotThrow(
        () => vm.runInContext(source, context, { filename: file }),
        `${file} on ${page}`
      );
    }
  });
}
