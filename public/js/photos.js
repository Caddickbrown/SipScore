/* =============================================
   photos.js — shared photo picking for Add Drink, Edit Drink and the Feed
   ============================================= */

/* global App */

const MAX_PHOTOS = 6;
// Vercel rejects request bodies over 4.5 MB; stay comfortably under it.
const MAX_UPLOAD_CHARS = 4_000_000;

// Downscale to fit maxSide and re-encode as JPEG. Returns a data URL.
function resizePhoto(file, maxSide = 800, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

function photosSize(photos) {
  return photos.reduce((total, src) => total + src.length, 0);
}

/*
 * A picker bound to a gallery element, a file input and (optionally) the
 * label that opens it. Keeps its own list and re-renders on change.
 *
 *   const picker = createPhotoPicker({ gallery, input, button, count, maxSide });
 *   picker.set(existingPhotos);  picker.get();  picker.changed;
 */
function createPhotoPicker({ gallery, input, button, count, maxSide = 800, onChange }) {
  let photos = [];
  let changed = false;
  const emptyCountText = count ? count.textContent : '';

  function render() {
    gallery.replaceChildren();
    photos.forEach((src, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'photo-gallery-thumb';
      wrap.appendChild(App.imageEl(src, `Photo ${i + 1}`));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'photo-gallery-remove';
      remove.setAttribute('aria-label', `Remove photo ${i + 1}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        photos.splice(i, 1);
        changed = true;
        render();
      });
      wrap.appendChild(remove);
      gallery.appendChild(wrap);
    });

    const full = photos.length >= MAX_PHOTOS;
    if (button) button.classList.toggle('is-full', full);
    if (input) input.disabled = full;
    if (count) {
      count.textContent = photos.length ? `(${photos.length} / ${MAX_PHOTOS})` : emptyCountText;
    }
    if (onChange) onChange(photos);
  }

  async function addFiles(files) {
    for (const file of files) {
      if (photos.length >= MAX_PHOTOS) {
        App.showToast(`Up to ${MAX_PHOTOS} photos`, 'error');
        break;
      }
      try {
        const data = await resizePhoto(file, maxSide);
        if (photosSize(photos) + data.length > MAX_UPLOAD_CHARS) {
          App.showToast('That’s as many photos as fit in one upload', 'error');
          break;
        }
        photos.push(data);
        changed = true;
      } catch {
        App.showToast('Could not load a photo', 'error');
      }
    }
    render();
  }

  if (input) {
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.value = '';
      if (files.length) addFiles(files);
    });
  }

  render();

  return {
    set(list) { photos = [...list]; changed = false; render(); },
    get() { return [...photos]; },
    clear() { photos = []; changed = false; render(); },
    get changed() { return changed; },
    // Stored form: JSON array, or null when there are none.
    serialise() { return photos.length ? JSON.stringify(photos) : null; },
  };
}

window.Photos = { resizePhoto, createPhotoPicker, MAX_PHOTOS, MAX_UPLOAD_CHARS };
