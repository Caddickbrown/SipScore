/* edit-drink.js — Edit an existing drink's info and photos */

/* global App, DrinkForm, Photos */

document.addEventListener('DOMContentLoaded', async () => {
  const user = App.requireAuth();
  if (!user) return;

  const drinkId = parseInt(new URLSearchParams(window.location.search).get('id'), 10);
  if (!drinkId) {
    window.location.replace('/drinks.html');
    return;
  }

  DrinkForm.init({ errorId: 'editError' });

  const picker = Photos.createPhotoPicker({
    gallery: document.getElementById('photoGallery'),
    input: document.getElementById('drinkPhotoInput'),
    button: document.getElementById('photoPickerBtn'),
    count: document.getElementById('photoCount'),
    maxSide: 800,
  });

  const backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.href = '/rate.html?id=' + drinkId;

  try {
    const { drink } = await App.apiFetch('/api/drink?' + App.tripParams({ id: String(drinkId) }).toString());
    document.getElementById('heroBadge').textContent = App.badgeLabel(drink.category, drink.type);
    document.getElementById('heroTitle').textContent = drink.name;
    document.title = 'SipScore — Edit ' + drink.name;

    DrinkForm.fill(drink);
    picker.set(App.parsePhotos(drink.image));
    document.getElementById('editForm').style.display = 'block';
  } catch (err) {
    document.getElementById('heroTitle').textContent = 'Drink not found';
    App.showToast(err.message, 'error');
    return;
  }

  const form = document.getElementById('editDrinkForm');
  const btn = document.getElementById('saveBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fields = DrinkForm.read();
    const problem = DrinkForm.validate(fields);
    if (problem) {
      DrinkForm.setError(problem);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';
    DrinkForm.setError('');

    // Details and (if touched) photos go in one request.
    const body = { user_id: user.id, ...fields };
    if (picker.changed) body.image = picker.serialise();

    try {
      await App.apiFetch('/api/drink?id=' + drinkId, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      App.showToast('Changes saved!', 'success');
      setTimeout(() => window.location.replace('/rate.html?id=' + drinkId), 700);
    } catch (err) {
      DrinkForm.setError(err.message);
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });
});
