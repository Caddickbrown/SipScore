/* add-drink.js — Add a new drink */

let user;
let currentCategory = 'wine';

document.addEventListener('DOMContentLoaded', () => {
  user = App.requireAuth();
  if (!user) return;

  App.initNav('add');
  App.initProfileModal();
});

function setCategory(cat) {
  currentCategory = cat;

  document.getElementById('catWine').classList.toggle('active', cat === 'wine');
  document.getElementById('catCocktail').classList.toggle('active', cat === 'cocktail');

  document.getElementById('wineFields').style.display = cat === 'wine' ? 'block' : 'none';
  document.getElementById('cocktailFields').style.display = cat === 'cocktail' ? 'block' : 'none';

  document.getElementById('addError').textContent = '';
}

async function handleAdd(e) {
  e.preventDefault();

  const name = document.getElementById('drinkName').value.trim();
  if (!name) {
    document.getElementById('addError').textContent = 'Please enter a drink name';
    return;
  }

  let type, style, source;

  if (currentCategory === 'wine') {
    type = document.getElementById('wineType').value || null;
    style = document.getElementById('wineStyle').value || null;
    source = document.getElementById('wineSource').value.trim() || null;
  } else {
    type = document.getElementById('cocktailType').value || null;
    style = document.getElementById('cocktailStyle').value || null;
    source = document.getElementById('cocktailSource').value.trim() || null;
  }

  const btn = document.getElementById('addBtn');
  btn.disabled = true;
  btn.textContent = 'Adding…';
  document.getElementById('addError').textContent = '';

  try {
    const data = await App.apiFetch('/api/drinks', {
      method: 'POST',
      body: JSON.stringify({
        name,
        category: currentCategory,
        type,
        style,
        source,
        user_id: user.id,
      }),
    });

    App.showToast(`${name} added!`, 'success');

    // Go rate the new drink
    setTimeout(() => {
      window.location.href = `/rate.html?id=${data.drink.id}`;
    }, 700);
  } catch (err) {
    document.getElementById('addError').textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Add Drink';
  }
}
