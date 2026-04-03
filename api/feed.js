const { neon } = require('@neondatabase/serverless');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function ensureTables(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS feed_posts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS feed_likes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, post_id)
    )
  `;
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);
  await ensureTables(sql);

  // GET — list all posts, newest first, with like counts + viewer's like state
  if (req.method === 'GET') {
    const viewer_id = parseInt(req.query?.user_id) || null;
    try {
      const posts = await sql`
        SELECT
          fp.id,
          fp.content,
          fp.created_at,
          u.id            AS user_id,
          u.name          AS user_name,
          u.avatar_colour,
          COUNT(fl.id)::int AS like_count,
          BOOL_OR(fl.user_id = ${viewer_id}) AS liked_by_viewer
        FROM feed_posts fp
        JOIN users u ON u.id = fp.user_id
        LEFT JOIN feed_likes fl ON fl.post_id = fp.id
        GROUP BY fp.id, fp.content, fp.created_at, u.id, u.name, u.avatar_colour
        ORDER BY fp.created_at DESC
        LIMIT 100
      `;
      return res.json({ posts });
    } catch (err) {
      console.error('GET feed error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // POST — create a post
  if (req.method === 'POST') {
    const { user_id, content } = req.body || {};

    if (!user_id || !content || !content.trim()) {
      return res.status(400).json({ error: 'user_id and content are required' });
    }

    const trimmed = content.trim();
    if (trimmed.length > 500) {
      return res.status(400).json({ error: 'Content must be 500 characters or fewer' });
    }

    try {
      const [post] = await sql`
        INSERT INTO feed_posts (user_id, content)
        VALUES (${parseInt(user_id)}, ${trimmed})
        RETURNING id, content, created_at
      `;
      return res.status(201).json({ post });
    } catch (err) {
      console.error('POST feed error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — remove own post
  if (req.method === 'DELETE') {
    const { user_id, post_id } = req.body || {};

    if (!user_id || !post_id) {
      return res.status(400).json({ error: 'user_id and post_id are required' });
    }

    try {
      const result = await sql`
        DELETE FROM feed_posts
        WHERE id = ${parseInt(post_id)} AND user_id = ${parseInt(user_id)}
        RETURNING id
      `;
      if (result.length === 0) {
        return res.status(404).json({ error: 'Post not found or not yours' });
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('DELETE feed error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
