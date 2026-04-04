/* =============================================
   feed.js — Shared feed page
   ============================================= */

const user = App.requireAuth();
if (!user) throw new Error('Not authenticated');

App.initNav('feed');
App.initProfileModal();

// ---- Compose ----

const composeAvatar = document.getElementById('composeAvatar');
if (composeAvatar) {
  composeAvatar.style.background = user.avatar_colour || '#c9a96e';
  composeAvatar.textContent = App.avatarInitials(user.name);
}

const textarea = document.getElementById('postContent');
const charCount = document.getElementById('charCount');
const postBtn = document.getElementById('postBtn');

textarea.addEventListener('input', () => {
  const remaining = 500 - textarea.value.length;
  charCount.textContent = remaining;
  charCount.classList.toggle('feed-char-warn', remaining < 50);
});

postBtn.addEventListener('click', submitPost);
textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitPost();
});

async function submitPost() {
  const content = textarea.value.trim();
  if (!content) return;

  postBtn.disabled = true;
  postBtn.textContent = 'Posting…';

  try {
    await App.apiFetch('/api/feed', {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, content }),
    });
    textarea.value = '';
    charCount.textContent = '500';
    charCount.classList.remove('feed-char-warn');
    await loadFeed();
    App.showToast('Posted!');
  } catch (err) {
    App.showToast(err.message || 'Failed to post', 'error');
  } finally {
    postBtn.disabled = false;
    postBtn.textContent = 'Post';
  }
}

// ---- Feed ----

async function loadFeed() {
  const list = document.getElementById('feedList');

  try {
    const { posts } = await App.apiFetch(`/api/feed?user_id=${user.id}`);
    renderFeed(posts);
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>Failed to load feed.</p></div>`;
  }
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function renderFeed(posts) {
  const list = document.getElementById('feedList');

  if (!posts.length) {
    list.innerHTML = `
      <div class="empty-state">
        <p>No posts yet. Be the first to share something!</p>
      </div>`;
    return;
  }

  list.innerHTML = posts.map(post => {
    const isOwn = post.user_id === user.id;
    const initials = App.avatarInitials(post.user_name);
    const content = DOMPurify.sanitize(post.content);
    const liked = post.liked_by_viewer;
    const likeCount = post.like_count || 0;
    const replyCount = post.reply_count || 0;

    return `
      <article class="feed-post" data-id="${post.id}">
        <div class="feed-post-avatar" style="background:${post.avatar_colour || '#c9a96e'}">${initials}</div>
        <div class="feed-post-body">
          <div class="feed-post-header">
            <span class="feed-post-name">${DOMPurify.sanitize(post.user_name)}</span>
            <span class="feed-post-time">${timeAgo(post.created_at)}</span>
            ${isOwn ? `<button class="feed-delete-btn" data-id="${post.id}" aria-label="Delete post">
              <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>` : ''}
          </div>
          <p class="feed-post-content">${content}</p>
          <div class="feed-post-actions">
            <button class="feed-like-btn ${liked ? 'liked' : ''}" data-id="${post.id}" data-liked="${liked ? '1' : '0'}">
              <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span class="feed-like-count">${likeCount > 0 ? likeCount : ''}</span>
            </button>
            <button class="feed-reply-btn" data-id="${post.id}">
              <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span class="feed-reply-count">${replyCount > 0 ? replyCount : ''}</span>
            </button>
          </div>
          <div class="feed-replies" data-post-id="${post.id}">
            <div class="feed-replies-list"></div>
            <div class="feed-reply-compose">
              <div class="feed-reply-compose-avatar" style="background:${user.avatar_colour || '#c9a96e'}">${App.avatarInitials(user.name)}</div>
              <textarea class="feed-reply-textarea" placeholder="Write a reply…" maxlength="280" rows="1"></textarea>
              <button class="btn btn-primary feed-reply-submit-btn">Reply</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');

  // Like buttons
  list.querySelectorAll('.feed-like-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleLike(btn));
  });

  // Delete buttons
  list.querySelectorAll('.feed-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deletePost(parseInt(btn.dataset.id)));
  });

  // Reply toggle buttons
  list.querySelectorAll('.feed-reply-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleReplies(btn));
  });

  // Reply submit buttons
  list.querySelectorAll('.feed-reply-submit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const repliesSection = btn.closest('.feed-replies');
      submitReply(repliesSection);
    });
  });

  // Reply textarea — submit on Ctrl+Enter
  list.querySelectorAll('.feed-reply-textarea').forEach(ta => {
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        const repliesSection = ta.closest('.feed-replies');
        submitReply(repliesSection);
      }
    });
  });
}

async function toggleLike(btn) {
  const postId = parseInt(btn.dataset.id);
  const wasLiked = btn.dataset.liked === '1';

  // Optimistic update
  btn.dataset.liked = wasLiked ? '0' : '1';
  btn.classList.toggle('liked', !wasLiked);
  const countEl = btn.querySelector('.feed-like-count');
  const current = parseInt(countEl.textContent) || 0;
  const next = wasLiked ? Math.max(0, current - 1) : current + 1;
  countEl.textContent = next > 0 ? next : '';

  try {
    const { liked, like_count } = await App.apiFetch('/api/feed-like', {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, post_id: postId }),
    });
    btn.dataset.liked = liked ? '1' : '0';
    btn.classList.toggle('liked', liked);
    countEl.textContent = like_count > 0 ? like_count : '';
  } catch {
    // Revert optimistic update
    btn.dataset.liked = wasLiked ? '1' : '0';
    btn.classList.toggle('liked', wasLiked);
    countEl.textContent = current > 0 ? current : '';
  }
}

async function deletePost(postId) {
  if (!confirm('Delete this post?')) return;

  try {
    await App.apiFetch('/api/feed', {
      method: 'DELETE',
      body: JSON.stringify({ user_id: user.id, post_id: postId }),
    });
    await loadFeed();
    App.showToast('Post deleted');
  } catch (err) {
    App.showToast(err.message || 'Failed to delete', 'error');
  }
}

// ---- Replies ----

async function toggleReplies(btn) {
  const postId = parseInt(btn.dataset.id);
  const article = btn.closest('.feed-post');
  const repliesSection = article.querySelector('.feed-replies');

  const isOpen = repliesSection.classList.contains('open');
  if (isOpen) {
    repliesSection.classList.remove('open');
    return;
  }

  repliesSection.classList.add('open');
  await loadReplies(postId, repliesSection);
}

async function loadReplies(postId, repliesSection) {
  const listEl = repliesSection.querySelector('.feed-replies-list');
  listEl.innerHTML = '<div class="feed-reply-item"><div class="feed-reply-body" style="color:var(--slate);font-size:0.82rem">Loading…</div></div>';

  try {
    const { replies } = await App.apiFetch(`/api/feed-replies?post_id=${postId}&viewer_id=${user.id}`);
    renderReplies(replies, repliesSection, postId);
  } catch (err) {
    listEl.innerHTML = '<div class="feed-reply-item"><div class="feed-reply-body" style="color:#e05c5c;font-size:0.82rem">Failed to load replies.</div></div>';
  }
}

function replyItemHTML(reply, postId, isSubReply = false) {
  const isOwn = reply.user_id === user.id;
  const initials = App.avatarInitials(reply.user_name);
  const content = DOMPurify.sanitize(reply.content);
  const liked = reply.liked_by_viewer;
  const likeCount = reply.like_count || 0;
  const avatarSize = isSubReply ? 22 : 28;
  const avatarClass = isSubReply ? 'feed-sub-reply-compose-avatar' : 'feed-reply-avatar';

  return `
    <div class="feed-reply-item" data-reply-id="${reply.id}">
      <div class="${avatarClass}" style="width:${avatarSize}px;height:${avatarSize}px;background:${reply.avatar_colour || '#c9a96e'}">${initials}</div>
      <div class="feed-reply-body">
        <div class="feed-reply-header">
          <span class="feed-reply-name">${DOMPurify.sanitize(reply.user_name)}</span>
          <span class="feed-reply-time">${timeAgo(reply.created_at)}</span>
          ${isOwn ? `<button class="feed-reply-delete-btn" data-id="${reply.id}" data-post-id="${postId}" aria-label="Delete reply">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>` : ''}
        </div>
        <p class="feed-reply-content">${content}</p>
        <div class="feed-reply-actions">
          <button class="feed-reply-like-btn ${liked ? 'liked' : ''}" data-id="${reply.id}" data-liked="${liked ? '1' : '0'}">
            <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span class="feed-reply-like-count">${likeCount > 0 ? likeCount : ''}</span>
          </button>
          ${!isSubReply ? `<button class="feed-reply-reply-btn" data-id="${reply.id}" data-post-id="${postId}">Reply</button>` : ''}
        </div>
        ${!isSubReply ? `<div class="feed-sub-replies" data-parent-id="${reply.id}"></div>` : ''}
      </div>
    </div>
  `;
}

function renderReplies(replies, repliesSection, postId) {
  const listEl = repliesSection.querySelector('.feed-replies-list');

  // Split into top-level and sub-replies
  const topLevel = replies.filter(r => !r.parent_reply_id);
  const subMap = {};
  replies.filter(r => r.parent_reply_id).forEach(r => {
    (subMap[r.parent_reply_id] = subMap[r.parent_reply_id] || []).push(r);
  });

  if (!topLevel.length) {
    listEl.innerHTML = '';
  } else {
    listEl.innerHTML = topLevel.map(reply => replyItemHTML(reply, postId, false)).join('');

    // Inject sub-replies
    topLevel.forEach(reply => {
      const subs = subMap[reply.id] || [];
      const subContainer = listEl.querySelector(`.feed-sub-replies[data-parent-id="${reply.id}"]`);
      if (subContainer && subs.length) {
        subContainer.innerHTML = subs.map(sub => replyItemHTML(sub, postId, true)).join('');
      }
    });
  }

  // Wire up all events
  listEl.querySelectorAll('.feed-reply-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteReply(parseInt(btn.dataset.id), parseInt(btn.dataset.postId), repliesSection));
  });

  listEl.querySelectorAll('.feed-reply-like-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleReplyLike(btn));
  });

  listEl.querySelectorAll('.feed-reply-reply-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleSubReplyCompose(btn, postId, repliesSection));
  });
}

async function toggleReplyLike(btn) {
  const replyId = parseInt(btn.dataset.id);
  const wasLiked = btn.dataset.liked === '1';

  // Optimistic update
  btn.dataset.liked = wasLiked ? '0' : '1';
  btn.classList.toggle('liked', !wasLiked);
  const countEl = btn.querySelector('.feed-reply-like-count');
  const current = parseInt(countEl.textContent) || 0;
  const next = wasLiked ? Math.max(0, current - 1) : current + 1;
  countEl.textContent = next > 0 ? next : '';

  try {
    const { liked, like_count } = await App.apiFetch('/api/feed-reply-like', {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, reply_id: replyId }),
    });
    btn.dataset.liked = liked ? '1' : '0';
    btn.classList.toggle('liked', liked);
    countEl.textContent = like_count > 0 ? like_count : '';
  } catch {
    // Revert
    btn.dataset.liked = wasLiked ? '1' : '0';
    btn.classList.toggle('liked', wasLiked);
    countEl.textContent = current > 0 ? current : '';
  }
}

function toggleSubReplyCompose(btn, postId, repliesSection) {
  const parentReplyId = parseInt(btn.dataset.id);
  const replyItem = btn.closest('.feed-reply-item');
  const subContainer = replyItem.querySelector(`.feed-sub-replies[data-parent-id="${parentReplyId}"]`);

  // If compose box already open, close it
  const existing = subContainer.querySelector('.feed-sub-reply-compose');
  if (existing) {
    existing.remove();
    return;
  }

  const compose = document.createElement('div');
  compose.className = 'feed-sub-reply-compose';
  compose.innerHTML = `
    <div class="feed-sub-reply-compose-avatar" style="background:${user.avatar_colour || '#c9a96e'}">${App.avatarInitials(user.name)}</div>
    <textarea class="feed-sub-reply-textarea" placeholder="Reply…" maxlength="280" rows="1"></textarea>
    <button class="btn btn-primary feed-sub-reply-submit-btn">Reply</button>
  `;
  subContainer.appendChild(compose);

  const ta = compose.querySelector('.feed-sub-reply-textarea');
  const submitBtn = compose.querySelector('.feed-sub-reply-submit-btn');
  ta.focus();

  const doSubmit = () => submitSubReply(postId, parentReplyId, ta, submitBtn, repliesSection);
  submitBtn.addEventListener('click', doSubmit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doSubmit();
  });
}

async function submitSubReply(postId, parentReplyId, ta, submitBtn, repliesSection) {
  const content = ta.value.trim();
  if (!content) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Replying…';

  try {
    await App.apiFetch('/api/feed-replies', {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, post_id: postId, parent_reply_id: parentReplyId, content }),
    });

    // Update top-level reply count on the post's reply toggle button
    const article = repliesSection.closest('.feed-post');
    const replyBtn = article.querySelector('.feed-reply-btn');
    const countEl = replyBtn.querySelector('.feed-reply-count');
    const current = parseInt(countEl.textContent) || 0;
    countEl.textContent = current + 1;

    await loadReplies(postId, repliesSection);
  } catch (err) {
    App.showToast(err.message || 'Failed to post reply', 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Reply';
  }
}

async function submitReply(repliesSection) {
  const postId = parseInt(repliesSection.dataset.postId);
  const ta = repliesSection.querySelector('.feed-reply-textarea');
  const submitBtn = repliesSection.querySelector('.feed-reply-submit-btn');
  const content = ta.value.trim();
  if (!content) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Replying…';

  try {
    await App.apiFetch('/api/feed-replies', {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, post_id: postId, content }),
    });
    ta.value = '';

    // Update reply count on the toggle button
    const article = repliesSection.closest('.feed-post');
    const replyBtn = article.querySelector('.feed-reply-btn');
    const countEl = replyBtn.querySelector('.feed-reply-count');
    const current = parseInt(countEl.textContent) || 0;
    countEl.textContent = current + 1;

    await loadReplies(postId, repliesSection);
  } catch (err) {
    App.showToast(err.message || 'Failed to post reply', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Reply';
  }
}

async function deleteReply(replyId, postId, repliesSection) {
  if (!confirm('Delete this reply?')) return;

  try {
    await App.apiFetch('/api/feed-replies', {
      method: 'DELETE',
      body: JSON.stringify({ user_id: user.id, reply_id: replyId }),
    });

    // Update reply count on the toggle button
    const article = repliesSection.closest('.feed-post');
    const replyBtn = article.querySelector('.feed-reply-btn');
    const countEl = replyBtn.querySelector('.feed-reply-count');
    const current = parseInt(countEl.textContent) || 0;
    countEl.textContent = Math.max(0, current - 1) || '';

    await loadReplies(postId, repliesSection);
  } catch (err) {
    App.showToast(err.message || 'Failed to delete reply', 'error');
  }
}

// ---- Init ----
loadFeed();
