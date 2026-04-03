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

// ---- Init ----
loadFeed();
