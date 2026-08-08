/* =============================================
   tests/helpers/neon-shim.js
   ---------------------------------------------
   Backs the @neondatabase/serverless tagged-template API with a real
   Postgres connection so the API handlers can be exercised end-to-end
   against actual SQL. Loaded into require.cache before the handlers are
   required, so they pick it up without any test seams in production code.
   ============================================= */

const { Client } = require('pg');

function makeSql(client) {
  // neon's `sql` is a tagged template returning a promise of a rows array.
  const sql = (strings, ...values) => {
    let text = '';
    strings.forEach((chunk, i) => {
      text += chunk;
      if (i < values.length) text += '$' + (i + 1);
    });
    return client.query(text, values).then(result => result.rows);
  };
  return sql;
}

// Swap the driver out for our shim before any handler requires it.
function installShim(client) {
  const modulePath = require.resolve('@neondatabase/serverless');
  const sql = makeSql(client);
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: { neon: () => sql },
  };
  return sql;
}

async function connect(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

// Minimal stand-in for a Vercel request/response pair.
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

function mockReq(method, { query = {}, body = {} } = {}) {
  return { method, query, body };
}

// Runs a handler and returns { status, body }.
async function call(handler, method, options) {
  const req = mockReq(method, options);
  const res = mockRes();
  await handler(req, res);
  return { status: res.statusCode, body: res.body };
}

module.exports = { installShim, connect, call, mockReq, mockRes };
