/* =============================================
   side-panel.js — the desktop panel on Drinks
   ---------------------------------------------
   Group top 3, your progress on this trip, and the invite code. Only shown
   on wide screens (see .side-panel in style.css); on a phone nothing here
   is fetched. Uses endpoints the page already relies on.
   ============================================= */

/* global App */

(function () {
  const panel = document.getElementById('sidePanel');
  if (!panel) return;
  const wide = window.matchMedia('(min-width: 1200px)');
  let loaded = false;

  function text(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value;
    return el;
  }

  function renderTop(items) {
    const box = document.getElementById('sideTop');
    box.replaceChildren();
    if (items.length === 0) {
      box.appendChild(text('p', 'side-empty', 'No group ratings yet.'));
      return;
    }
    items.slice(0, 3).forEach((item, i) => {
      const a = document.createElement('a');
      a.className = 'side-top-row side-top-' + (i + 1);
      a.href = '/rate.html?id=' + encodeURIComponent(item.id) + '&from=leaderboard-social';
      a.append(
        text('span', 'side-top-rank', String(i + 1)),
        text('span', 'side-top-name', item.name),
        text('span', 'side-top-score', (parseFloat(item.avg_stars) || 0).toFixed(1))
      );
      box.appendChild(a);
    });
  }

  function renderProgress(drinks) {
    const box = document.getElementById('sideProgress');
    box.replaceChildren();
    const total = drinks.length;
    if (total === 0) {
      box.appendChild(text('p', 'side-empty', 'No drinks on this trip yet.'));
      return;
    }
    const rated = drinks.filter(d => parseInt(d.my_stars, 10) > 0).length;
    const line = document.createElement('div');
    line.className = 'side-progress-line';
    line.append(
      text('span', 'side-progress-num', String(rated)),
      text('span', 'side-progress-of', `of ${total} drink${total !== 1 ? 's' : ''} rated`)
    );
    const track = document.createElement('div');
    track.className = 'side-progress-track';
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${rated} of ${total} drinks rated`);
    const fill = document.createElement('div');
    fill.className = 'side-progress-fill';
    fill.style.width = (rated / total * 100) + '%';
    track.appendChild(fill);
    const left = total - rated;
    box.append(line, track, text('p', 'side-note', left === 0 ? 'You have rated everything.' : `${left} to go.`));
  }

  function renderCode() {
    const trip = App.getTrip();
    const wrap = document.getElementById('sideCodeWrap');
    if (!trip || !trip.invite_code) { wrap.hidden = true; return; }
    document.getElementById('sideCode').textContent = trip.invite_code;
    document.getElementById('sideCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(trip.invite_code);
        App.showToast('Invite code copied');
      } catch {
        App.showToast('Could not copy — select the code instead', 'error');
      }
    });
  }

  async function load() {
    if (loaded || !App.getUser() || !App.getTripId()) return;
    loaded = true;
    renderCode();
    try {
      const lb = await App.apiFetch('/api/leaderboard?' + App.tripParams({ type: 'social' }).toString());
      renderTop(lb.leaderboard || []);
      const dr = await App.apiFetch('/api/drinks?' + App.tripParams({ scope: 'trip' }).toString());
      renderProgress(dr.drinks || []);
    } catch (err) {
      document.getElementById('sideTop').replaceChildren(text('p', 'side-empty', 'Could not load this panel.'));
    }
  }

  function maybeLoad() { if (wide.matches) load(); }
  document.addEventListener('DOMContentLoaded', () => {
    maybeLoad();
    if (wide.addEventListener) wide.addEventListener('change', maybeLoad);
  });
})();
