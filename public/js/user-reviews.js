/* user-reviews.js — A trip-mate's ratings on the active trip */

/* global App, Reviews */

document.addEventListener('DOMContentLoaded', () => {
  const currentUser = App.requireAuth();
  if (!currentUser) return;

  const params = new URLSearchParams(window.location.search);
  const profileUserId = parseInt(params.get('user_id'), 10);

  if (!profileUserId) {
    window.location.replace('/drinks.html');
    return;
  }

  // Viewing your own profile? That's My Reviews.
  if (profileUserId === currentUser.id) {
    window.location.replace('/my-reviews.html');
    return;
  }

  App.initNav();
  App.initTripPill();
  App.initProfileModal();
  loadUserProfile(profileUserId);

  Reviews.initReviewList({
    emptyText: 'They haven’t rated any drinks on this trip yet.',
    load: async () => {
      // user_id is whose ratings; viewer_id is who's asking (checked for membership).
      const query = new URLSearchParams({
        type: 'personal',
        user_id: String(profileUserId),
        viewer_id: String(currentUser.id),
      });
      const tripId = App.getTripId();
      if (tripId) query.set('trip_id', tripId);
      const data = await App.apiFetch('/api/leaderboard?' + query.toString());
      return data.leaderboard;
    },
  });
});

async function loadUserProfile(profileUserId) {
  const nameEl = document.getElementById('userProfileName');
  const statsEl = document.getElementById('userProfileStats');
  const avatarEl = document.getElementById('userProfileAvatar');

  try {
    const query = new URLSearchParams({ id: String(profileUserId) });
    const tripId = App.getTripId();
    if (tripId) query.set('trip_id', tripId);
    const { user } = await App.apiFetch('/api/profile?' + query.toString());

    nameEl.textContent = user.name;
    document.title = 'SipScore — ' + user.name + '’s Reviews';
    App.applyAvatarToEl(avatarEl, user);
    statsEl.textContent = user.rating_count + ' drink' + (user.rating_count !== 1 ? 's' : '') + ' rated';
  } catch {
    nameEl.textContent = 'User';
    document.title = 'SipScore — User Reviews';
  }
}
