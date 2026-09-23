/* =============================================
   theme.js — resolves light/dark before first paint
   ---------------------------------------------
   Loaded synchronously in <head> on every page, so the page never flashes
   the wrong theme. Always sets data-theme on <html>: the stylesheet has a
   single [data-theme="dark"] definition and no prefers-color-scheme rules.
   Order of precedence: the user's stored choice, then the OS setting.
   ============================================= */
(function () {
  var KEY = 'sipscore-theme';
  var COLOURS = { light: '#1a2744', dark: '#0f1929' };
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try {
      var value = localStorage.getItem(KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch (e) {
      return null;
    }
  }

  function resolve() {
    return stored() || (media && media.matches ? 'dark' : 'light');
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', COLOURS[theme]);
    var listeners = window.SipTheme ? window.SipTheme._listeners : [];
    for (var j = 0; j < listeners.length; j++) listeners[j](theme);
  }

  window.SipTheme = {
    _listeners: [],
    current: function () { return document.documentElement.getAttribute('data-theme') || resolve(); },
    set: function (theme) {
      try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode: still apply */ }
      apply(theme);
    },
    toggle: function () { this.set(this.current() === 'dark' ? 'light' : 'dark'); },
    onChange: function (fn) { this._listeners.push(fn); },
  };

  apply(resolve());

  // Follow the OS live, unless the user has picked a theme themselves.
  if (media) {
    var follow = function () { if (!stored()) apply(resolve()); };
    if (media.addEventListener) media.addEventListener('change', follow);
    else if (media.addListener) media.addListener(follow);
  }
})();
