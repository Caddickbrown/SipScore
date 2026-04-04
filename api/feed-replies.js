const { neon } = require('@neondatabase/serverless');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS feed_replies (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_reply_id INTEGER REFERENCES feed_replies(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Migration for existing tables
  await sql`ALTER TABLE feed_replies ADD COLUMN IF NOT EXISTS parent_reply_id INTEGER REFERENCES feed_replies(id) ON DELETE CASCADE`;
  await sql`
    CREATE TABLE IF NOT EXISTS feed_reply_likes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reply_id INTEGER NOT NULL REFERENCES feed_replies(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, reply_id)
    )
  `;
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);
  await ensureTable(sql);

  // GET — list replies for a post
  if (req.method === 'GET') {
    const post_id = parseInt(req.query?.post_id);
    const viewer_id = parseInt(req.query?.viewer_id) || null;
    if (!post_id) {
      return res.status(400).json({ error: 'post_id is required' });
    }
    try {
      const replies = await sql`
        SELECT
          fr.id,
          fr.content,
          fr.created_at,
          fr.parent_reply_id,
          u.id            AS user_id,
          u.name          AS user_name,
          u.avatar_colour,
          u.avatar_image,
          COUNT(frl.id)::int AS like_count,
          BOOL_OR(frl.user_id = ${viewer_id}) AS liked_by_viewer
        FROM feed_replies fr
        JOIN users u ON u.id = fr.user_id
        LEFT JOIN feed_reply_likes frl ON frl.reply_id = fr.id
        WHERE fr.post_id = ${post_id}
        GROUP BY fr.id, fr.content, fr.created_at, fr.parent_reply_id,
                 u.id, u.name, u.avatar_colour, u.avatar_image
        ORDER BY fr.created_at ASC
      `;
      return res.json({ replies });
    } catch (err) {
      console.error('GET feed-replies error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — create a reply (or sub-reply)
  if (req.method === 'POST') {
    const { user_id, post_id, content, parent_reply_id } = req.body || {};

    if (!user_id || !post_id || !content || !content.trim()) {
      return res.status(400).json({ error: 'user_id, post_id, and content are required' });
    }

    const trimmed = content.trim();
    if (trimmed.length > 280) {
      return res.status(400).json({ error: 'Reply must be 280 characters or fewer' });
    }

    const parentId = parent_reply_id ? parseInt(parent_reply_id) : null;

    try {
      const [reply] = await sql`
        INSERT INTO feed_replies (post_id, user_id, parent_reply_id, content)
        VALUES (${parseInt(post_id)}, ${parseInt(user_id)}, ${parentId}, ${trimmed})
        RETURNING id, content, created_at, parent_reply_id
      `;
      return res.status(201).json({ reply });
    } catch (err) {
      console.error('POST feed-replies error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — remove own reply
  if (req.method === 'DELETE') {
    const { user_id, reply_id } = req.body || {};

    if (!user_id || !reply_id) {
      return res.status(400).json({ error: 'user_id and reply_id are required' });
    }

    try {
      const result = await sql`
        DELETE FROM feed_replies
        WHERE id = ${parseInt(reply_id)} AND user_id = ${parseInt(user_id)}
        RETURNING id
      `;
      if (result.length === 0) {
        return res.status(404).json({ error: 'Reply not found or not yours' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('DELETE feed-replies error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
