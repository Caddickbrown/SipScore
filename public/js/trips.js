/* trips.js — Choose, create and join trips */

/* global App */

let user;
let trips = [];
let editingTripId = null;   // null when the form is creating rather than editing
let detailTrip = null;
let previewTimer;

document.addEventListener('DOMContentLoaded', () => {
  user = App.requireAuth();
  if (!user) return;

  App.initNav('trips');
  App.initProfileModal();

  document.getElementById('newTripBtn').addEventListener('click', () => openTripModal());
  document.getElementById('joinTripBtn').addEventListener('click', openJoinModal);
  document.getElementById('copyCodeBtn').addEventListener('click', copyInviteCode);
  document.getElementById('detailSwitchBtn').addEventListener('click', switchToDetailTrip);
  document.getElementById('detailEditBtn').addEventListener('click', () => {
    closeDetailModal();
    openTripModal(detailTrip);
  });
  document.getElementById('detailLeaveBtn').addEventListener('click', leaveDetailTrip);

  dismissOnBackdrop('newTripModal', closeTripModal);
  dismissOnBackdrop('joinTripModal', closeJoinModal);
  dismissOnBackdrop('tripDetailModal', closeDetailModal);

  const codeInput = document.getElementById('joinCode');
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    clearTimeout(previewTimer);
    previewTimer = setTimeout(previewCode, 350);
  });

  loadTrips();
});

function dismissOnBackdrop(id, close) {
  const overlay = document.getElementById(id);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

/* ---------------------------------------------
   List
   --------------------------------------------- */

async function loadTrips() {
  const list = document.getElementById('tripsList');
  try {
    const data = await App.apiFetch(`/api/trips?user_id=${user.id}`);
    trips = data.trips || [];
    syncActiveTrip();
    renderTrips();
  } catch (err) {
    list.innerHTML = '';
    list.appendChild(emptyState('Could not load trips', err.message));
  }
}

// Keep the stored active trip honest: drop it if we're no longer on it, and
// auto-select when there's only one sensible choice.
function syncActiveTrip() {
  const active = App.getTrip();
  const match = active ? trips.find(t => t.id === active.id) : null;

  if (match) {
    App.setTrip(match);
  } else if (trips.length > 0) {
    App.setTrip(trips[0]);
  } else {
    App.clearTrip();
  }
}

function renderTrips() {
  const list = document.getElementById('tripsList');
  list.innerHTML = '';

  if (trips.length === 0) {
    list.appendChild(emptyState(
      'No trips yet',
      'Create a trip for your next holiday, or join one with a code from a friend.'
    ));
    return;
  }

  const activeId = App.getTripId();
  trips.forEach(trip => list.appendChild(tripCard(trip, trip.id === activeId)));
}

function tripCard(trip, isActive) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'trip-card' + (isActive ? ' active' : '');
  card.addEventListener('click', () => openDetailModal(trip));

  const body = document.createElement('div');
  body.className = 'trip-card-body';

  const top = document.createElement('div');
  top.className = 'trip-card-top';

  const name = document.createElement('div');
  name.className = 'trip-name';
  name.textContent = trip.name;
  top.appendChild(name);

  if (isActive) {
    const badge = document.createElement('span');
    badge.className = 'trip-active-badge';
    badge.textContent = 'Active';
    top.appendChild(badge);
  }

  const meta = document.createElement('div');
  meta.className = 'trip-meta';
  meta.textContent = [trip.destination, App.formatTripDates(trip)].filter(Boolean).join(' • ');

  const stats = document.createElement('div');
  stats.className = 'trip-stats';
  stats.appendChild(statChip(trip.member_count, 'member'));
  stats.appendChild(statChip(trip.drink_count, 'drink'));
  stats.appendChild(statChip(trip.rating_count, 'rating'));

  body.appendChild(top);
  if (meta.textContent) body.appendChild(meta);
  body.appendChild(stats);

  const arrow = document.createElement('div');
  arrow.className = 'drink-card-arrow';
  arrow.textContent = '›';

  card.appendChild(body);
  card.appendChild(arrow);
  return card;
}

function statChip(count, noun) {
  const n = parseInt(count) || 0;
  const span = document.createElement('span');
  span.className = 'trip-stat';
  span.textContent = `${n} ${noun}${n === 1 ? '' : 's'}`;
  return span;
}

function emptyState(title, desc) {
  const div = document.createElement('div');
  div.className = 'empty-state';

  const icon = document.createElement('div');
  icon.className = 'empty-state-icon';
  icon.textContent = '●';

  const h3 = document.createElement('h3');
  h3.textContent = title;

  const p = document.createElement('p');
  p.textContent = desc;

  div.appendChild(icon);
  div.appendChild(h3);
  div.appendChild(p);
  return div;
}

/* ---------------------------------------------
   Create / edit
   --------------------------------------------- */

function openTripModal(trip = null) {
  editingTripId = trip ? trip.id : null;

  document.getElementById('tripFormTitle').textContent = trip ? 'Edit Trip' : 'New Trip';
  document.getElementById('tripSaveBtn').textContent = trip ? 'Save Changes' : 'Create Trip';
  document.getElementById('tripName').value = trip ? trip.name : '';
  document.getElementById('tripDestination').value = trip && trip.destination ? trip.destination : '';
  document.getElementById('tripStart').value = isoDate(trip && trip.start_date);
  document.getElementById('tripEnd').value = isoDate(trip && trip.end_date);
  document.getElementById('tripFormError').textContent = '';

  showModal('newTripModal');
}

function isoDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

function closeTripModal() {
  hideModal('newTripModal');
  editingTripId = null;
}

async function saveTrip(event) {
  event.preventDefault();

  const btn = document.getElementById('tripSaveBtn');
  const errorEl = document.getElementById('tripFormError');
  errorEl.textContent = '';

  const payload = {
    user_id: user.id,
    name: document.getElementById('tripName').value.trim(),
    destination: document.getElementById('tripDestination').value.trim() || null,
    start_date: document.getElementById('tripStart').value || null,
    end_date: document.getElementById('tripEnd').value || null,
  };

  const isEdit = editingTripId !== null;
  btn.disabled = true;
  btn.textContent = isEdit ? 'Saving…' : 'Creating…';

  try {
    const data = await App.apiFetch('/api/trips', {
      method: isEdit ? 'PATCH' : 'POST',
      body: JSON.stringify(isEdit
        ? { ...payload, trip_id: editingTripId }
        : { ...payload, action: 'create' }),
    });

    // A brand-new trip becomes the one you're rating on.
    if (!isEdit) App.setTrip(data.trip);
    else if (App.getTripId() === editingTripId) App.setTrip(data.trip);

    closeTripModal();
    App.showToast(isEdit ? 'Trip updated' : `${data.trip.name} is ready — happy sipping!`);
    await loadTrips();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? 'Save Changes' : 'Create Trip';
  }
}

/* ---------------------------------------------
   Join by invite code
   --------------------------------------------- */

function openJoinModal() {
  document.getElementById('joinCode').value = '';
  document.getElementById('joinPreview').innerHTML = '';
  document.getElementById('joinFormError').textContent = '';
  showModal('joinTripModal');
  setTimeout(() => document.getElementById('joinCode').focus(), 120);
}

function closeJoinModal() {
  hideModal('joinTripModal');
}

// Show what you're about to join before you commit to it.
async function previewCode() {
  const code = document.getElementById('joinCode').value.trim();
  const preview = document.getElementById('joinPreview');
  const errorEl = document.getElementById('joinFormError');

  if (code.length < 4) {
    preview.innerHTML = '';
    return;
  }

  try {
    const { trip } = await App.apiFetch(`/api/trips?code=${encodeURIComponent(code)}&user_id=${user.id}`);
    errorEl.textContent = '';
    preview.innerHTML = '';

    const name = document.createElement('div');
    name.className = 'join-preview-name';
    name.textContent = trip.name;

    const meta = document.createElement('div');
    meta.className = 'join-preview-meta';
    const parts = [trip.destination, App.formatTripDates(trip)].filter(Boolean);
    parts.push(`${trip.member_count} member${trip.member_count === 1 ? '' : 's'}`);
    meta.textContent = parts.join(' • ');

    preview.appendChild(name);
    preview.appendChild(meta);

    if (trip.role) {
      const already = document.createElement('div');
      already.className = 'join-preview-meta';
      already.textContent = "You're already on this trip.";
      preview.appendChild(already);
    }
  } catch {
    preview.innerHTML = '';
  }
}

async function joinTrip(event) {
  event.preventDefault();

  const btn = document.getElementById('joinSaveBtn');
  const errorEl = document.getElementById('joinFormError');
  errorEl.textContent = '';

  const code = document.getElementById('joinCode').value.trim();
  btn.disabled = true;
  btn.textContent = 'Joining…';

  try {
    const data = await App.apiFetch('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ action: 'join', user_id: user.id, invite_code: code }),
    });

    App.setTrip(data.trip);
    closeJoinModal();
    App.showToast(`You're on ${data.trip.name}!`);
    await loadTrips();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Join Trip';
  }
}

/* ---------------------------------------------
   Trip detail
   --------------------------------------------- */

async function openDetailModal(trip) {
  detailTrip = trip;

  document.getElementById('detailName').textContent = trip.name;
  document.getElementById('detailMeta').textContent =
    [trip.destination, App.formatTripDates(trip)].filter(Boolean).join(' • ') || 'No dates set';
  document.getElementById('detailCode').textContent = trip.invite_code;

  const isOwner = trip.role === 'owner';
  document.getElementById('detailEditBtn').style.display = isOwner ? 'block' : 'none';
  document.getElementById('detailLeaveBtn').textContent = isOwner ? 'Delete Trip' : 'Leave Trip';

  const isActive = App.getTripId() === trip.id;
  const switchBtn = document.getElementById('detailSwitchBtn');
  switchBtn.style.display = isActive ? 'none' : 'block';

  const membersEl = document.getElementById('detailMembers');
  membersEl.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';

  showModal('tripDetailModal');

  try {
    const data = await App.apiFetch(`/api/trips?id=${trip.id}&user_id=${user.id}`);
    membersEl.innerHTML = '';
    (data.members || []).forEach(m => membersEl.appendChild(memberRow(m)));
  } catch (err) {
    membersEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'form-error';
    p.textContent = err.message;
    membersEl.appendChild(p);
  }
}

function memberRow(member) {
  const row = document.createElement('div');
  row.className = 'trip-member-row';

  const avatar = App.renderAvatarEl(member, 34, 'user-avatar');
  row.appendChild(avatar);

  const info = document.createElement('div');
  info.className = 'trip-member-info';

  const name = document.createElement('div');
  name.className = 'trip-member-name';
  name.textContent = member.name + (member.id === user.id ? ' (you)' : '');

  const meta = document.createElement('div');
  meta.className = 'trip-member-meta';
  const count = parseInt(member.rating_count) || 0;
  meta.textContent = `${count} rating${count === 1 ? '' : 's'}`
    + (member.role === 'owner' ? ' • Organiser' : '');

  info.appendChild(name);
  info.appendChild(meta);
  row.appendChild(info);
  return row;
}

function closeDetailModal() {
  hideModal('tripDetailModal');
  detailTrip = null;
}

function switchToDetailTrip() {
  if (!detailTrip) return;
  App.setTrip(detailTrip);
  App.showToast(`Now sipping on ${detailTrip.name}`);
  closeDetailModal();
  renderTrips();
}

async function copyInviteCode() {
  if (!detailTrip) return;
  try {
    await navigator.clipboard.writeText(detailTrip.invite_code);
    App.showToast('Invite code copied');
  } catch {
    App.showToast('Could not copy — long-press the code instead', 'error');
  }
}

async function leaveDetailTrip() {
  if (!detailTrip) return;

  const isOwner = detailTrip.role === 'owner';
  const message = isOwner
    ? `Delete "${detailTrip.name}"? Its ratings and posts go with it — drinks stay in the catalogue.`
    : `Leave "${detailTrip.name}"? Your ratings on this trip stay with it.`;

  if (!confirm(message)) return;

  try {
    await App.apiFetch('/api/trips', {
      method: 'DELETE',
      body: JSON.stringify({
        user_id: user.id,
        trip_id: detailTrip.id,
        action: isOwner ? 'delete' : 'leave',
      }),
    });

    if (App.getTripId() === detailTrip.id) App.clearTrip();
    closeDetailModal();
    App.showToast(isOwner ? 'Trip deleted' : 'You left the trip');
    await loadTrips();
  } catch (err) {
    App.showToast(err.message, 'error');
  }
}

/* ---------------------------------------------
   Modal plumbing
   --------------------------------------------- */

function showModal(id) {
  document.getElementById(id).classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function hideModal(id) {
  document.getElementById(id).classList.remove('visible');
  document.body.style.overflow = '';
}
