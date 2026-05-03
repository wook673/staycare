const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/* ─── Postgres pool (only when DATABASE_URL is configured) ─── */
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  pool
    .query(`
      CREATE TABLE IF NOT EXISTS leads (
        id          SERIAL PRIMARY KEY,
        host_name   TEXT NOT NULL,
        city        TEXT NOT NULL,
        dong        TEXT NOT NULL,
        phone       TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    .then(() => console.log('[db] leads table ready'))
    .catch((err) => console.error('[db] table init failed:', err.message));
} else {
  console.warn('[db] DATABASE_URL not set — DB persistence disabled');
}

/* ─── Static page routes ─── */
const PAGE_ROUTES = {
  '/':                       'statcare_product.html',
  '/index.html':             'statcare_product.html',
  '/statcare_product.html':  'statcare_product.html',
  '/apply':                  'apply.html',
  '/apply.html':             'apply.html',
};

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // POST /apply — form submission
  if (req.method === 'POST' && (url === '/apply' || url === '/apply.html')) {
    return handleApply(req, res);
  }

  // GET /admin/leads — protected lead viewer
  if (req.method === 'GET' && url === '/admin/leads') {
    return handleAdmin(req, res);
  }

  // GET static pages
  if (req.method === 'GET' && PAGE_ROUTES[url]) {
    const filePath = path.join(__dirname, PAGE_ROUTES[url]);
    return fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

/* ─── /apply handler ─── */
async function handleApply(req, res) {
  try {
    const body = await readBody(req, 10 * 1024); // 10KB cap
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return jsonResp(res, 400, { ok: false, error: 'invalid_json' });
    }

    const hostName = (data.hostName || '').trim().slice(0, 80);
    const city     = (data.city     || '').trim().slice(0, 40);
    const dong     = (data.dong     || '').trim().slice(0, 40);
    const phone    = (data.phone    || '').trim().slice(0, 30);

    if (!hostName || !city || !dong || !phone) {
      return jsonResp(res, 400, { ok: false, error: 'missing_fields' });
    }

    let dbStatus = 'skipped';
    if (pool) {
      try {
        await pool.query(
          'INSERT INTO leads (host_name, city, dong, phone) VALUES ($1, $2, $3, $4)',
          [hostName, city, dong, phone]
        );
        dbStatus = 'saved';
      } catch (err) {
        console.error('[db] insert failed:', err.message);
        dbStatus = 'failed';
      }
    }

    console.log(`[lead] ${hostName} | ${city} ${dong} | ${phone} | db=${dbStatus}`);
    return jsonResp(res, 200, { ok: true, db: dbStatus });
  } catch (err) {
    console.error('[apply] handler error:', err.message);
    return jsonResp(res, 500, { ok: false, error: 'server_error' });
  }
}

/* ─── /admin/leads handler ─── */
async function handleAdmin(req, res) {
  if (!ADMIN_PASSWORD) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Admin disabled — set ADMIN_PASSWORD env var on Railway');
  }
  if (!pool) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Database not configured (DATABASE_URL missing)');
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    return unauthorized(res);
  }

  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8');
  const colon = decoded.indexOf(':');
  const user = colon === -1 ? '' : decoded.slice(0, colon);
  const pass = colon === -1 ? '' : decoded.slice(colon + 1);
  if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) {
    return unauthorized(res);
  }

  try {
    const r = await pool.query(
      'SELECT id, host_name, city, dong, phone, created_at FROM leads ORDER BY created_at DESC LIMIT 200'
    );
    const rows = r.rows
      .map(
        (row) => `
      <tr>
        <td>${row.id}</td>
        <td>${esc(row.host_name)}</td>
        <td>${esc(row.city)} ${esc(row.dong)}</td>
        <td><a href="tel:${esc(row.phone)}">${esc(row.phone)}</a></td>
        <td>${formatDate(row.created_at)}</td>
      </tr>`
      )
      .join('');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderAdmin(r.rowCount, rows));
  } catch (err) {
    console.error('[admin] query failed:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Database error');
  }
}

function unauthorized(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="STAYCARE Admin"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Unauthorized');
}

function renderAdmin(count, rows) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>STAYCARE — 신청자 목록</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:2rem 1.5rem;max-width:1100px;margin:0 auto;background:#fafaf7;color:#1a1a1a;line-height:1.5;}
h1{font-size:1.5rem;margin-bottom:0.25rem;letter-spacing:-0.5px;}
.meta{color:#5a5a5a;margin-bottom:1.5rem;font-size:0.875rem;}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e3dd;border-radius:10px;overflow:hidden;}
th,td{text-align:left;padding:12px 16px;border-bottom:1px solid #f0eee8;font-size:0.875rem;vertical-align:top;}
th{background:#f6f4ee;font-weight:600;color:#3a3a3a;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.5px;}
tr:last-child td{border-bottom:none;}
tr:hover td{background:#fafaf7;}
a{color:#0E9A78;text-decoration:none;}
a:hover{text-decoration:underline;}
.empty{padding:2rem;text-align:center;color:#8a8a8a;}
.refresh{margin-top:1rem;display:inline-block;color:#5a5a5a;font-size:0.8125rem;text-decoration:none;}
.refresh:hover{color:#1a1a1a;}
</style>
</head>
<body>
<h1>STAYCARE 신청자 목록</h1>
<p class="meta">총 ${count}건 · 최신순 · 최대 200건</p>
<table>
  <thead><tr><th>#</th><th>호스트명</th><th>위치</th><th>연락처</th><th>신청일시</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="empty">아직 신청 내역이 없습니다</td></tr>'}</tbody>
</table>
<a class="refresh" href="/admin/leads">↻ 새로고침</a>
</body>
</html>`;
}

/* ─── Helpers ─── */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > maxBytes) {
        reject(new Error('payload_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function jsonResp(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

server.listen(PORT, () => {
  console.log(`[server] Listening on ${PORT} | db=${!!pool} admin=${!!ADMIN_PASSWORD}`);
});
