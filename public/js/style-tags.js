/* =============================================
   style-tags.js — multi-select tag pickers (wine style, serve style…)
   Shared by Add Drink and Edit Drink. Tags are stored comma-joined.
   ============================================= */

/* global App */

function makeTag(container, value, active) {
  const tag = document.createElement('button');
  tag.type = 'button';
  tag.className = 'style-tag';
  tag.dataset.tag = value;
  tag.textContent = value;
  App.setPressed(tag, active);
  tag.addEventListener('click', (e) => {
    e.preventDefault();
    App.setPressed(tag, !tag.classList.contains('active'));
  });
  return tag;
}

function initStyleTags(containerId) {
  const container = document.getElementById(containerId);
  if (!container || container.dataset.ready) return;
  container.dataset.ready = '1';

  // Re-create the preset tags so they share one code path (and aria-pressed).
  container.querySelectorAll('.style-tag').forEach(btn => {
    btn.replaceWith(makeTag(container, btn.dataset.tag, btn.classList.contains('active')));
  });

  const wrap = document.createElement('div');
  wrap.className = 'style-tag-custom';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'style-tag-custom-input';
  input.placeholder = 'Custom…';
  input.maxLength = 40;
  input.autocapitalize = 'words';
  input.setAttribute('aria-label', 'Add your own tag');

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'style-tag-custom-btn';
  addBtn.textContent = '+';
  addBtn.setAttribute('aria-label', 'Add tag');

  wrap.append(input, addBtn);
  container.appendChild(wrap);

  function addCustomTag() {
    // Commas separate tags in storage, so they can't appear inside one.
    const value = input.value.replace(/,/g, ' ').trim();
    if (!value) return;
    const existing = [...container.querySelectorAll('.style-tag')]
      .find(b => b.dataset.tag.toLowerCase() === value.toLowerCase());
    if (existing) App.setPressed(existing, true);
    else container.insertBefore(makeTag(container, value, true), wrap);
    input.value = '';
  }

  addBtn.addEventListener('click', (e) => { e.preventDefault(); addCustomTag(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomTag(); }
  });
}

function getStyleTags(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  const active = [...container.querySelectorAll('.style-tag.active')].map(b => b.dataset.tag);
  return active.length ? active.join(',') : null;
}

// Selects the stored tags, adding any custom ones that aren't presets.
function setStyleTags(containerId, value) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const wanted = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  const lower = new Set(wanted.map(s => s.toLowerCase()));

  container.querySelectorAll('.style-tag').forEach(btn => {
    App.setPressed(btn, lower.has(btn.dataset.tag.toLowerCase()));
  });

  const present = new Set([...container.querySelectorAll('.style-tag')].map(b => b.dataset.tag.toLowerCase()));
  const customWrap = container.querySelector('.style-tag-custom');
  wanted.forEach(tag => {
    if (present.has(tag.toLowerCase())) return;
    present.add(tag.toLowerCase());
    container.insertBefore(makeTag(container, tag, true), customWrap);
  });
}

window.StyleTags = { initStyleTags, getStyleTags, setStyleTags };
