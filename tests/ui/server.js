/* =============================================
   tests/ui/server.js — a tiny stand-in for `vercel dev`
   ---------------------------------------------
   Serves public/ exactly as vercel.json rewrites it, and routes /api/<name>
   to api/<name>.js. The handlers talk to a real Postgres through the same
   neon shim the integration tests use, so the browser tests exercise the
   whole stack. Used by tests/ui/run.js; can also be run on its own:

     TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/sipscore_ui node tests/ui/server.js
   ============================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { installShim } = require('../helpers/neon-shim');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// Vercel caps request bodies at 4.5 MB and answers 413 in plain text.
const BODY_LIMIT = 4.5 * 1024 * 1024;

function vercelResponse(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

async function start({ databaseUrl, port = 0 } = {}) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  installShim(client);

  const handlers = {};
  for (const file of fs.readdirSync(path.join(ROOT, 'api'))) {
    if (file.endsWith('.js')) handlers[file.slice(0, -3)] = require(path.join(ROOT, 'api', file));
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      const handler = handlers[url.pathname.slice(5)];
      if (!handler) { res.statusCode = 404; return res.end('Not found'); }

      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size <= BODY_LIMIT) chunks.push(chunk);
      });
      req.on('end', async () => {
        if (size > BODY_LIMIT) {
          res.statusCode = 413;
          res.setHeader('Content-Type', 'text/plain');
          return res.end('Request Entity Too Large');
        }
        let body = {};
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
        req.query = Object.fromEntries(url.searchParams);
        req.body = body;
        try {
          await handler(req, vercelResponse(res));
        } catch (err) {
          res.statusCode = 500;
          res.end('Unhandled: ' + err.message);
        }
      });
      return undefined;
    }

    let file = path.join(PUBLIC, decodeURIComponent(url.pathname));
    if (url.pathname === '/') file = path.join(PUBLIC, 'index.html');
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    return fs.createReadStream(file).pipe(res);
  });

  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    client,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await client.end();
    },
  };
}

module.exports = { start };

if (require.main === module) {
  start({ databaseUrl: process.env.TEST_DATABASE_URL, port: Number(process.env.PORT) || 3000 })
    .then(s => console.log('SipScore test server on', s.url));
}
