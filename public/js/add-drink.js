/* add-drink.js — Add a new drink */

/* global App, DrinkForm, Photos */

document.addEventListener('DOMContentLoaded', () => {
  const user = App.requireAuth();
  if (!user) return;
  if (!App.requireTrip()) return;

  App.initNav('add');
  App.initTripPill();
  App.initProfileModal();
  DrinkForm.init({ errorId: 'addError' });

  const picker = Photos.createPhotoPicker({
    gallery: document.getElementById('photoGallery'),
    input: document.getElementById('drinkPhotoInput'),
    button: document.getElementById('photoPickerBtn'),
    count: document.getElementById('photoCount'),
    maxSide: 800,
  });

  // "Add Drink?" from an empty search pre-fills the name.
  const prefillName = new URLSearchParams(window.location.search).get('name');
  if (prefillName) document.getElementById('drinkName').value = prefillName.slice(0, 200);

  const form = document.getElementById('addDrinkForm');
  const btn = document.getElementById('addBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fields = DrinkForm.read();
    const problem = DrinkForm.validate(fields);
    if (problem) {
      DrinkForm.setError(problem);
      document.getElementById('drinkName').focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Adding…';
    DrinkForm.setError('');

    try {
      const data = await App.apiFetch('/api/drinks', {
        method: 'POST',
        body: JSON.stringify(App.tripBody({ ...fields, image: picker.serialise() })),
      });
      App.showToast(fields.name + ' added!', 'success');
      setTimeout(() => {
        window.location.href = '/rate.html?id=' + data.drink.id;
      }, 700);
    } catch (err) {
      DrinkForm.setError(err.message);
      btn.disabled = false;
      btn.textContent = 'Add Drink';
    }
  });
});
