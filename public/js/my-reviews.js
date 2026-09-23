/* my-reviews.js — All of the current user's ratings on the active trip */

/* global App, Reviews */

document.addEventListener('DOMContentLoaded', () => {
  const user = App.requireAuth();
  if (!user) return;
  if (!App.requireTrip()) return;

  App.initNav('reviews');
  App.initTripPill();
  App.initProfileModal();

  Reviews.initReviewList({
    emptyText: 'Head to Drinks to start rating!',
    load: async () => {
      const params = App.tripParams({ type: 'personal' });
      const data = await App.apiFetch('/api/leaderboard?' + params.toString());
      return data.leaderboard;
    },
  });
});
