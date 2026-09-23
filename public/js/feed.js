/* =============================================
   feed.js — The trip's shared feed
   ---------------------------------------------
   Every value from the server that ends up in a template string goes
   through App.escapeHtml; images are created as elements with .src set,
   never interpolated into markup.
   ============================================= */

/* global App, Photos */

const esc = s => App.escapeHtml(s);

const ICONS = {
  edit: '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  reply: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
};

const MAX_POST = 500;

let user;
let pendingPhotos = [];          // data URLs for the post being composed
let oldestPostId = null;         // cursor for "Load older posts"
const postContent = new Map();   // post id -> raw text, for editing

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function countText(n) {
  return n > 0 ? String(n) : '';
}

/* ---------------------------------------------
   Compose
   --------------------------------------------- */

function renderComposeStrip() {
  const strip = document.getElementById('composePhotoStrip');
  strip.replaceChildren();
  pendingPhotos.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'feed-compose-thumb';
    wrap.appendChild(App.imageEl(src, `Photo ${i + 1}`));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'feed-compose-thumb-remove';
    remove.setAttribute('aria-label', `Remove photo ${i + 1}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      pendingPhotos.splice(i, 1);
      renderComposeStrip();
    });
    wrap.appendChild(remove);
    strip.appendChild(wrap);
  });
}

async function addComposePhotos(files) {
  for (const file of files) {
    if (pendingPhotos.length >= Photos.MAX_PHOTOS) {
      App.showToast(`Up to ${Photos.MAX_PHOTOS} photos`, 'error');
      break;
    }
    try {
      const data = await Photos.resizePhoto(file, 1200, 0.8);
      const total = pendingPhotos.reduce((sum, src) => sum + src.length, 0) + data.length;
      if (total > Photos.MAX_UPLOAD_CHARS) {
        App.showToast('That’s as many photos as fit in one post', 'error');
        break;
      }
      pendingPhotos.push(data);
    } catch {
      App.showToast('Could not load photo', 'error');
    }
  }
  renderComposeStrip();
}

function resetCompose() {
  const textarea = document.getElementById('postContent');
  const charCount = document.getElementById('charCount');
  textarea.value = '';
  charCount.textContent = String(MAX_POST);
  charCount.classList.remove('feed-char-warn');
  pendingPhotos = [];
  renderComposeStrip();
}

async function submitPost() {
  const textarea = document.getElementById('postContent');
  const postBtn = document.getElementById('postBtn');
  const content = textarea.value.trim();
  if ((!content && !pendingPhotos.length) || postBtn.disabled) return;

  postBtn.disabled = true;
  postBtn.textContent = 'Posting…';

  try {
    const body = App.tripBody({ content });
    if (pendingPhotos.length) body.image = JSON.stringify(pendingPhotos);

    const { post } = await App.apiFetch('/api/feed', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    resetCompose();
    prependPost(post);
    App.showToast('Posted!');
  } catch (err) {
    App.showToast(err.message || 'Failed to post', 'error');
  } finally {
    postBtn.disabled = false;
    postBtn.textContent = 'Post';
  }
}

/* ---------------------------------------------
   Posts
   --------------------------------------------- */

function postHTML(post) {
  const isOwn = post.user_id === user.id;
  const liked = Boolean(post.liked_by_viewer);
  const id = Number(post.id);
  const userId = Number(post.user_id);

  return `
    <article class="feed-post" data-id="${id}">
      <div class="feed-post-avatar user-link" data-user-id="${userId}" role="button" tabindex="0" aria-label="${esc(post.user_name)}’s profile"></div>
      <div class="feed-post-body">
        <div class="feed-post-header">
          <span class="feed-post-name user-link" data-user-id="${userId}">${esc(post.user_name)}</span>
          <span class="feed-post-time">${esc(timeAgo(post.created_at))}</span>
          ${isOwn ? `
          <button class="feed-edit-btn" data-action="edit-post" aria-label="Edit post">${ICONS.edit}</button>
          <button class="feed-delete-btn" data-action="delete-post" aria-label="Delete post">${ICONS.trash}</button>` : ''}
        </div>
        <p class="feed-post-content"${post.content ? '' : ' hidden'}>${esc(post.content || '')}</p>
        <div class="feed-post-photos-slot"></div>
        <div class="feed-post-actions">
          <button class="feed-like-btn${liked ? ' liked' : ''}" data-action="like-post" data-liked="${liked ? '1' : '0'}" aria-pressed="${liked}" aria-label="Like">
            ${ICONS.heart}
            <span class="feed-like-count">${countText(post.like_count)}</span>
          </button>
          <button class="feed-reply-btn" data-action="toggle-replies" aria-expanded="false" aria-label="Replies">
            ${ICONS.reply}
            <span class="feed-reply-count">${countText(post.reply_count)}</span>
          </button>
        </div>
        <div class="feed-replies" data-post-id="${id}">
          <div class="feed-replies-list"></div>
          <div class="feed-reply-compose">
            <div class="feed-reply-compose-avatar"></div>
            <textarea class="feed-reply-textarea" placeholder="Write a reply…" maxlength="280" rows="1" aria-label="Write a reply"></textarea>
            <button class="btn btn-primary feed-reply-submit-btn" data-action="submit-reply">Reply</button>
          </div>
        </div>
      </div>
    </article>`;
}

function buildPost(post) {
  const tpl = document.createElement('template');
  tpl.innerHTML = postHTML(post).trim();
  const article = tpl.content.firstElementChild;

  postContent.set(post.id, post.content || '');

  App.applyAvatarToEl(article.querySelector('.feed-post-avatar'), {
    avatar_image: post.avatar_image, avatar_colour: post.avatar_colour, name: post.user_name,
  });
  App.applyAvatarToEl(article.querySelector('.feed-reply-compose-avatar'), user);

  const photos = App.parsePhotos(post.image);
  if (photos.length) {
    const grid = document.createElement('div');
    grid.className = `feed-post-photos feed-post-photos--${Math.min(photos.length, 4)}`;
    photos.slice(0, Photos.MAX_PHOTOS).forEach((src, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'feed-post-photo-wrap';
      wrap.appendChild(App.imageEl(src, `Photo ${i + 1}`));
      grid.appendChild(wrap);
    });
    article.querySelector('.feed-post-photos-slot').replaceWith(grid);
  } else {
    article.querySelector('.feed-post-photos-slot').remove();
  }
  return article;
}

function emptyFeed() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  const p = document.createElement('p');
  p.textContent = 'No posts yet. Be the first to share something!';
  div.appendChild(p);
  return div;
}

function prependPost(post) {
  const list = document.getElementById('feedList');
  const empty = list.querySelector('.empty-state');
  if (empty) empty.remove();
  list.prepend(buildPost(post));
}

function setLoadMore(visible) {
  const list = document.getElementById('feedList');
  let btn = document.getElementById('feedLoadMore');
  if (!visible) {
    if (btn) btn.remove();
    return;
  }
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'feedLoadMore';
    btn.type = 'button';
    btn.className = 'btn btn-outline btn-full feed-load-more';
    btn.textContent = 'Load older posts';
    btn.addEventListener('click', () => loadFeed({ append: true }));
  }
  list.after(btn);
}

async function loadFeed({ append = false } = {}) {
  const list = document.getElementById('feedList');
  const moreBtn = document.getElementById('feedLoadMore');
  if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = 'Loading…'; }

  try {
    const params = App.tripParams(append && oldestPostId ? { before_id: oldestPostId } : {});
    const { posts, has_more: hasMore } = await App.apiFetch('/api/feed?' + params.toString());

    if (!append) {
      list.replaceChildren();
      postContent.clear();
      if (!posts.length) list.appendChild(emptyFeed());
    }
    posts.forEach(post => list.appendChild(buildPost(post)));
    if (posts.length) oldestPostId = posts[posts.length - 1].id;
    setLoadMore(Boolean(hasMore));
  } catch (err) {
    if (!append) {
      list.replaceChildren();
      const div = document.createElement('div');
      div.className = 'empty-state';
      const p = document.createElement('p');
      p.textContent = 'Failed to load feed. ' + (err.message || '');
      div.appendChild(p);
      list.appendChild(div);
    } else {
      App.showToast(err.message || 'Could not load more posts', 'error');
    }
  } finally {
    const btn = document.getElementById('feedLoadMore');
    if (btn) { btn.disabled = false; btn.textContent = 'Load older posts'; }
  }
}

async function toggleLike(btn, { endpoint, idKey, id }) {
  const wasLiked = btn.dataset.liked === '1';
  const countEl = btn.querySelector('.feed-like-count, .feed-reply-like-count');
  const current = parseInt(countEl.textContent, 10) || 0;

  const show = (liked, count) => {
    btn.dataset.liked = liked ? '1' : '0';
    btn.classList.toggle('liked', liked);
    btn.setAttribute('aria-pressed', String(liked));
    countEl.textContent = countText(count);
  };

  show(!wasLiked, wasLiked ? Math.max(0, current - 1) : current + 1);   // optimistic

  try {
    const { liked, like_count: likeCount } = await App.apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, [idKey]: id }),
    });
    show(liked, likeCount);
  } catch (err) {
    show(wasLiked, current);
    App.showToast(err.message || 'Could not update like', 'error');
  }
}

function editPost(article) {
  const postId = Number(article.dataset.id);
  const contentEl = article.querySelector('.feed-post-content');
  if (article.querySelector('.feed-edit-compose')) return;   // already editing

  contentEl.hidden = true;

  const compose = document.createElement('div');
  compose.className = 'feed-edit-compose';

  const textarea = document.createElement('textarea');
  textarea.className = 'feed-textarea feed-edit-textarea';
  textarea.maxLength = MAX_POST;
  textarea.rows = 3;
  textarea.value = postContent.get(postId) || '';
  textarea.setAttribute('aria-label', 'Edit post');

  const actions = document.createElement('div');
  actions.className = 'feed-edit-actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-ghost btn-sm';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.className = 'btn btn-primary btn-sm';
  save.type = 'button';
  save.textContent = 'Save';
  actions.append(cancel, save);
  compose.append(textarea, actions);
  contentEl.after(compose);
  textarea.focus();

  const close = () => {
    compose.remove();
    contentEl.hidden = !contentEl.textContent;
  };
  cancel.addEventListener('click', close);

  save.addEventListener('click', async () => {
    const newContent = textarea.value.trim();
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      await App.apiFetch('/api/feed', {
        method: 'PATCH',
        body: JSON.stringify({ user_id: user.id, post_id: postId, content: newContent }),
      });
      postContent.set(postId, newContent);
      contentEl.textContent = newContent;
      close();
      App.showToast('Post updated');
    } catch (err) {
      App.showToast(err.message || 'Failed to save', 'error');
      save.disabled = false;
      save.textContent = 'Save';
    }
  });
}

async function deletePost(article) {
  if (!confirm('Delete this post?')) return;
  try {
    await App.apiFetch('/api/feed', {
      method: 'DELETE',
      body: JSON.stringify({ user_id: user.id, post_id: Number(article.dataset.id) }),
    });
    article.remove();
    const list = document.getElementById('feedList');
    if (!list.querySelector('.feed-post')) list.appendChild(emptyFeed());
    App.showToast('Post deleted');
  } catch (err) {
    App.showToast(err.message || 'Failed to delete', 'error');
  }
}

/* ---------------------------------------------
   Replies
   --------------------------------------------- */

function replyHTML(reply, isSubReply) {
  const isOwn = reply.user_id === user.id;
  const liked = Boolean(reply.liked_by_viewer);
  const avatarSize = isSubReply ? 22 : 28;
  const avatarClass = isSubReply ? 'feed-sub-reply-compose-avatar' : 'feed-reply-avatar';

  return `
    <div class="feed-reply-item" data-reply-id="${Number(reply.id)}">
      <div class="${avatarClass} user-link" data-user-id="${Number(reply.user_id)}" style="width:${avatarSize}px;height:${avatarSize}px"></div>
      <div class="feed-reply-body">
        <div class="feed-reply-header">
          <span class="feed-reply-name user-link" data-user-id="${Number(reply.user_id)}">${esc(reply.user_name)}</span>
          <span class="feed-reply-time">${esc(timeAgo(reply.created_at))}</span>
          ${isOwn ? `<button class="feed-reply-delete-btn" data-action="delete-reply" aria-label="Delete reply">${ICONS.trash}</button>` : ''}
        </div>
        <p class="feed-reply-content">${esc(reply.content)}</p>
        <div class="feed-reply-actions">
          <button class="feed-reply-like-btn${liked ? ' liked' : ''}" data-action="like-reply" data-liked="${liked ? '1' : '0'}" aria-pressed="${liked}" aria-label="Like reply">
            ${ICONS.heart}
            <span class="feed-reply-like-count">${countText(reply.like_count)}</span>
          </button>
          ${isSubReply ? '' : '<button class="feed-reply-reply-btn" data-action="compose-sub-reply">Reply</button>'}
        </div>
        ${isSubReply ? '' : `<div class="feed-sub-replies" data-parent-id="${Number(reply.id)}"></div>`}
      </div>
    </div>`;
}

function setReplyCount(article, count) {
  article.querySelector('.feed-reply-count').textContent = countText(count);
}

function renderReplies(article, replies) {
  const listEl = article.querySelector('.feed-replies-list');
  const topLevel = replies.filter(r => !r.parent_reply_id);
  const children = new Map();
  replies.filter(r => r.parent_reply_id).forEach(r => {
    if (!children.has(r.parent_reply_id)) children.set(r.parent_reply_id, []);
    children.get(r.parent_reply_id).push(r);
  });

  listEl.innerHTML = topLevel.map(r => replyHTML(r, false)).join('');
  topLevel.forEach(reply => {
    const subs = children.get(reply.id) || [];
    const container = listEl.querySelector(`.feed-sub-replies[data-parent-id="${Number(reply.id)}"]`);
    if (container && subs.length) container.innerHTML = subs.map(s => replyHTML(s, true)).join('');
  });

  replies.forEach(reply => {
    const el = listEl.querySelector(`.feed-reply-item[data-reply-id="${Number(reply.id)}"] > .user-link`);
    if (el) App.applyAvatarToEl(el, { avatar_image: reply.avatar_image, avatar_colour: reply.avatar_colour, name: reply.user_name });
  });

  // The server is the source of truth for the count (deleting a reply also
  // removes its sub-replies).
  setReplyCount(article, replies.length);
}

async function loadReplies(article) {
  const listEl = article.querySelector('.feed-replies-list');
  listEl.innerHTML = '<div class="feed-reply-item"><div class="feed-reply-body feed-reply-status">Loading…</div></div>';
  try {
    const { replies } = await App.apiFetch(
      `/api/feed-replies?post_id=${Number(article.dataset.id)}&viewer_id=${user.id}`
    );
    renderReplies(article, replies);
  } catch (err) {
    listEl.innerHTML = '<div class="feed-reply-item"><div class="feed-reply-body feed-reply-status feed-reply-error"></div></div>';
    listEl.querySelector('.feed-reply-error').textContent = err.message || 'Failed to load replies.';
  }
}

async function toggleReplies(article, btn) {
  const section = article.querySelector('.feed-replies');
  const open = !section.classList.contains('open');
  section.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  if (open) await loadReplies(article);
}

async function sendReply(article, { textarea, button, parentReplyId = null }) {
  const content = textarea.value.trim();
  if (!content || button.disabled) return;

  button.disabled = true;
  button.textContent = 'Replying…';
  try {
    await App.apiFetch('/api/feed-replies', {
      method: 'POST',
      body: JSON.stringify({
        user_id: user.id,
        post_id: Number(article.dataset.id),
        parent_reply_id: parentReplyId,
        content,
      }),
    });
    textarea.value = '';
    await loadReplies(article);
  } catch (err) {
    App.showToast(err.message || 'Failed to post reply', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Reply';
  }
}

function toggleSubReplyCompose(article, replyItem) {
  const parentReplyId = Number(replyItem.dataset.replyId);
  const container = replyItem.querySelector('.feed-sub-replies');
  const existing = container.querySelector('.feed-sub-reply-compose');
  if (existing) {
    existing.remove();
    return;
  }

  const compose = document.createElement('div');
  compose.className = 'feed-sub-reply-compose';
  const avatar = document.createElement('div');
  avatar.className = 'feed-sub-reply-compose-avatar';
  App.applyAvatarToEl(avatar, user);
  const textarea = document.createElement('textarea');
  textarea.className = 'feed-sub-reply-textarea';
  textarea.placeholder = 'Reply…';
  textarea.maxLength = 280;
  textarea.rows = 1;
  textarea.setAttribute('aria-label', 'Reply');
  const button = document.createElement('button');
  button.className = 'btn btn-primary feed-sub-reply-submit-btn';
  button.textContent = 'Reply';
  compose.append(avatar, textarea, button);
  container.appendChild(compose);
  textarea.focus();

  const submit = () => sendReply(article, { textarea, button, parentReplyId });
  button.addEventListener('click', submit);
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  });
}

async function deleteReply(article, replyItem) {
  if (!confirm('Delete this reply?')) return;
  try {
    await App.apiFetch('/api/feed-replies', {
      method: 'DELETE',
      body: JSON.stringify({ user_id: user.id, reply_id: Number(replyItem.dataset.replyId) }),
    });
    await loadReplies(article);
  } catch (err) {
    App.showToast(err.message || 'Failed to delete reply', 'error');
  }
}

/* ---------------------------------------------
   Lightbox
   --------------------------------------------- */

function initLightbox() {
  const lightbox = document.getElementById('photoLightbox');
  const img = document.getElementById('lightboxImg');
  const dots = document.getElementById('lightboxDots');
  const prev = document.getElementById('lightboxPrev');
  const next = document.getElementById('lightboxNext');
  let photos = [];
  let index = 0;
  let touchX = null;

  const isOpen = () => lightbox.style.display !== 'none';

  function show() {
    img.src = photos[index];
    const many = photos.length > 1;
    prev.style.visibility = many ? 'visible' : 'hidden';
    next.style.visibility = many ? 'visible' : 'hidden';
    dots.replaceChildren(...photos.map((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'lb-dot' + (i === index ? ' active' : '');
      return dot;
    }));
  }
  const step = delta => { index = (index + delta + photos.length) % photos.length; show(); };

  function open(list, start) {
    photos = list;
    index = start;
    lightbox.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    show();
  }
  function close() {
    lightbox.style.display = 'none';
    document.body.style.overflow = '';
    img.removeAttribute('src');
  }

  document.getElementById('lightboxClose').addEventListener('click', close);
  lightbox.addEventListener('click', e => {
    if (e.target.closest('button') || e.target === img) return;
    close();
  });
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));

  document.addEventListener('keydown', e => {
    if (!isOpen()) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  lightbox.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) >= 40) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  return { open };
}

/* ---------------------------------------------
   Wiring
   --------------------------------------------- */

function initFeed() {
  user = App.requireAuth();
  if (!user) return;
  if (!App.requireTrip()) return;

  App.initNav('feed');
  App.initTripPill();
  App.initProfileModal();

  const composeAvatar = document.getElementById('composeAvatar');
  if (composeAvatar) App.applyAvatarToEl(composeAvatar, user);

  const textarea = document.getElementById('postContent');
  const charCount = document.getElementById('charCount');
  const photoInput = document.getElementById('postPhotoInput');

  photoInput.addEventListener('change', () => {
    const files = Array.from(photoInput.files || []);
    photoInput.value = '';
    if (files.length) addComposePhotos(files);
  });
  textarea.addEventListener('input', () => {
    const remaining = MAX_POST - textarea.value.length;
    charCount.textContent = String(remaining);
    charCount.classList.toggle('feed-char-warn', remaining < 50);
  });
  document.getElementById('postBtn').addEventListener('click', submitPost);
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitPost();
  });

  const lightbox = initLightbox();
  const list = document.getElementById('feedList');

  // One delegated handler for everything inside the feed.
  list.addEventListener('click', e => {
    const article = e.target.closest('.feed-post');

    const photo = e.target.closest('.feed-post-photo-wrap');
    if (photo) {
      const imgs = Array.from(photo.parentElement.querySelectorAll('img'));
      lightbox.open(imgs.map(i => i.src), Math.max(0, imgs.indexOf(photo.querySelector('img'))));
      return;
    }

    const actionEl = e.target.closest('[data-action]');
    if (actionEl && article) {
      const replyItem = actionEl.closest('.feed-reply-item');
      switch (actionEl.dataset.action) {
        case 'like-post':
          return toggleLike(actionEl, { endpoint: '/api/feed-like', idKey: 'post_id', id: Number(article.dataset.id) });
        case 'like-reply':
          return toggleLike(actionEl, { endpoint: '/api/feed-reply-like', idKey: 'reply_id', id: Number(replyItem.dataset.replyId) });
        case 'edit-post': return editPost(article);
        case 'delete-post': return deletePost(article);
        case 'toggle-replies': return toggleReplies(article, actionEl);
        case 'submit-reply':
          return sendReply(article, { textarea: article.querySelector('.feed-reply-textarea'), button: actionEl });
        case 'compose-sub-reply': return toggleSubReplyCompose(article, replyItem);
        case 'delete-reply': return deleteReply(article, replyItem);
        default: return undefined;
      }
    }

    const userLink = e.target.closest('.user-link[data-user-id]');
    if (userLink) {
      const userId = Number(userLink.dataset.userId);
      if (!userId) return;
      if (userId === user.id) App.openProfileModal(user);
      else window.location.href = '/user-reviews.html?user_id=' + userId;
    }
  });

  list.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.classList.contains('feed-reply-textarea')) {
      const article = e.target.closest('.feed-post');
      sendReply(article, { textarea: e.target, button: article.querySelector('.feed-reply-submit-btn') });
    }
  });

  loadFeed();
}

initFeed();
