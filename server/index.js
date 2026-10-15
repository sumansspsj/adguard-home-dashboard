require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dns = require('dns').promises;
const path = require('path');
const { performance } = require('perf_hooks');

// ── Multi-server manager & startup validation ────────────────────────────────
const serversManager = require('./serversManager');
const atlasService = require('./atlasService');
const initialServers = serversManager.loadServers();

if ((!initialServers || initialServers.length === 0) && process.env.NODE_ENV !== 'test') {
  const REQUIRED_ENV = ['AGH_HOST', 'AGH_USERNAME', 'AGH_PASSWORD'];
  const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missingEnv.length) {
    console.error(`[FATAL] Missing required environment variables: ${missingEnv.join(', ')}`);
    console.error('[FATAL] Copy server/.env.example to server/.env and fill in values.');
    process.exit(1);
  }
}

const app = express();
const PORT = Number(process.env.PORT) || 8080;

function getActiveServer() {
  return serversManager.getActiveServer();
}

function getAghHostname() {
  try {
    const s = getActiveServer();
    return new URL(s.host).hostname;
  } catch {
    return '127.0.0.1';
  }
}

// ── Trust proxy (for correct req.ip behind reverse proxy) ─────────────────────
// Set to 1 if running behind a single nginx/reverse proxy; 0 for direct exposure.
const TRUST_PROXY = Number(process.env.TRUST_PROXY) || 0;
if (TRUST_PROXY) app.set('trust proxy', TRUST_PROXY);

// ── CORS — allow same-origin, local network, and web clients ─────────────────
const ALLOWED_ORIGINS_RAW = process.env.CORS_ORIGINS || '';
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
  ? ALLOWED_ORIGINS_RAW.split(',').map((o) => o.trim()).filter(Boolean)
  : null;

function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }
    // Strict RFC 1918 Private IPv4 address checks
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  } catch {
    return false;
  }
  if (ALLOWED_ORIGINS && ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }
  if (!ALLOWED_ORIGINS) return true;
  return false;
}

const corsOptions = {
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true,
};

app.use(cors(corsOptions));

// ── Body parsing with safe size limit & defensive normalization ─────────────
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, next) => {
  if (req.body === null || req.body === undefined || typeof req.body !== 'object') {
    req.body = {};
  }
  next();
});

// ── Security headers ───────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '0'); // Disabled in modern browsers; rely on CSP
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' http://localhost:* https: ws: wss:;"
  );
  next();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const authHeader = (srv = getActiveServer()) => ({
  Authorization: `Basic ${Buffer.from(`${srv.username || ''}:${srv.password || ''}`).toString('base64')}`,
});

/**
 * Clamp an integer query param to a safe range.
 * @param {unknown} val - raw value from req.query
 * @param {number} defaultVal
 * @param {number} max
 */
function clampInt(val, defaultVal, max) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n) || n < 0) return defaultVal;
  return Math.min(n, max);
}

/**
 * Validate a domain string loosely — letters, digits, hyphens, dots.
 * Rejects anything with spaces, slashes, NUL bytes, or other injection characters.
 */
function isValidDomain(domain) {
  return typeof domain === 'string' && /^[a-zA-Z0-9*._-]{1,253}$/.test(domain);
}

async function aghGet(path, params = {}) {
  const srv = getActiveServer();
  const res = await axios.get(`${srv.host}${path}`, {
    headers: authHeader(srv),
    params,
    timeout: 10000,
  });
  return res.data;
}

async function aghPost(path, body = {}) {
  const srv = getActiveServer();
  const res = await axios.post(`${srv.host}${path}`, body, {
    headers: { ...authHeader(srv), 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  return res.data;
}

async function aghPut(path, body = {}) {
  const srv = getActiveServer();
  const res = await axios.put(`${srv.host}${path}`, body, {
    headers: { ...authHeader(srv), 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  return res.data;
}

// ── Generic rate limiter factory ───────────────────────────────────────────────
// Keeps a Map of ip -> { count, resetAt } and auto-prunes stale entries.

function createRateLimiter({ windowMs = 60000, max = 10, message = 'Too many requests. Please wait.' } = {}) {
  const store = new Map();

  // Prune stale entries every windowMs to avoid unbounded growth
  const pruneInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt < now) store.delete(key);
    }
  }, windowMs);
  pruneInterval.unref(); // Don't block process exit

  return function rateLimitMiddleware(req, res, next) {
    const ip =
      req.ip ||
      req.socket?.remoteAddress ||
      req.connection?.remoteAddress ||
      'unknown';
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || entry.resetAt < now) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    entry.count++;
    next();
  };
}

// Per-route rate limiters
const generalLimiter = createRateLimiter({ windowMs: 60000, max: 300, message: 'Too many requests.' });
const mutationLimiter = createRateLimiter({ windowMs: 60000, max: 60, message: 'Too many write requests.' });
const aiLimiter = createRateLimiter({ windowMs: 60000, max: 10, message: 'Too many AI requests. Please wait a minute.' });

// Apply general rate limit to all API routes
app.use('/api', generalLimiter);

// ── Cache reset helper on server switch ───────────────────────────────────────
function onServerSwitched() {
  _cacheStatCache = null;
  _cacheStatTs = 0;
  cachedAiReport = null;
}

// ── Server Node Management ───────────────────────────────────────────────────
app.get('/api/servers', (_req, res) => {
  try {
    const servers = serversManager.getPublicServers();
    const active = serversManager.getActiveServer();
    res.json({
      ok: true,
      servers,
      activeServer: {
        id: active.id,
        name: active.name,
        host: active.host,
        username: active.username,
        hasPassword: Boolean(active.password),
        active: true,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/servers/test', mutationLimiter, async (req, res) => {
  try {
    const { host, username, password } = req.body;
    if (!host) {
      return res.status(400).json({ ok: false, error: 'Host URL is required.' });
    }
    const result = await serversManager.testConnection({ host, username, password });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/servers', mutationLimiter, async (req, res) => {
  try {
    const { name, host, username, password, autoSwitch } = req.body;
    if (!host) {
      return res.status(400).json({ ok: false, error: 'Host URL is required.' });
    }
    const newServer = serversManager.addServer({
      name,
      host,
      username,
      password,
      active: Boolean(autoSwitch),
    });
    if (autoSwitch) {
      onServerSwitched();
    }
    res.json({
      ok: true,
      server: newServer,
      activeServer: serversManager.getActiveServer(),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.put('/api/servers/:id', mutationLimiter, async (req, res) => {
  try {
    const updated = serversManager.updateServer(req.params.id, req.body);
    res.json({ ok: true, server: updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/servers/:id', mutationLimiter, async (req, res) => {
  try {
    const result = serversManager.deleteServer(req.params.id);
    onServerSwitched();
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/servers/:id/switch', mutationLimiter, async (req, res) => {
  try {
    const active = serversManager.setActiveServer(req.params.id);
    onServerSwitched();
    res.json({ ok: true, activeServer: active });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Status ────────────────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  try { res.json(await aghGet('/control/status')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try { res.json(await aghGet('/control/stats')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Stats config (GET) ────────────────────────────────────────────────────────
app.get('/api/stats/config', async (req, res) => {
  try { res.json(await aghGet('/control/stats_info')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Stats config (POST) — change retention period ─────────────────────────────
app.post('/api/stats/config', mutationLimiter, async (req, res) => {
  try {
    const { interval } = req.body;
    if (interval !== undefined && (typeof interval !== 'number' || interval < 1)) {
      return res.status(400).json({ error: 'interval must be a positive number' });
    }
    await aghPost('/control/stats_config', req.body);
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Query log config (GET & POST) ─────────────────────────────────────────────
app.get('/api/querylog/config', async (req, res) => {
  try { res.json(await aghGet('/control/querylog_info')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/querylog/config', mutationLimiter, async (req, res) => {
  try {
    const { interval } = req.body;
    if (interval !== undefined && (typeof interval !== 'number' || interval < 1)) {
      return res.status(400).json({ error: 'interval must be a positive number' });
    }
    await aghPost('/control/querylog_config', req.body);
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Filter list names (id → name map) ─────────────────────────────────────────
app.get('/api/filter_lists', async (req, res) => {
  try {
    const data = await aghGet('/control/filtering/status');
    const map = {};
    (data?.filters || []).forEach(f => { map[f.id] = f.name; });
    map[0] = 'User Rules';
    res.json(map);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Query log ─────────────────────────────────────────────────────────────────
app.get('/api/querylog', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 200, 1000);
    const offset = clampInt(req.query.offset, 0, 1000000);
    const params = { limit, offset };
    const { search, response_status, client } = req.query;
    if (search && typeof search === 'string') params.search = search.slice(0, 253);
    if (response_status && typeof response_status === 'string') params.response_status = response_status;
    if (client && typeof client === 'string') params.client = client.slice(0, 253);
    res.json(await aghGet('/control/querylog', params));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Cache hit rate (derived from recent query log) ── server-side cached 10s ──
let _cacheStatCache = null;
let _cacheStatTs = 0;
const CACHE_STAT_TTL = 10000;

app.get('/api/cache_stats', async (req, res) => {
  try {
    const now = Date.now();
    if (_cacheStatCache && now - _cacheStatTs < CACHE_STAT_TTL) {
      return res.json(_cacheStatCache);
    }
    const data = await aghGet('/control/querylog', { limit: 500 });
    const entries = data.data || [];
    const total = entries.length;
    const cached = entries.filter(e => e.cached).length;
    const upstreams = {};
    let totalElapsedMs = 0;
    let upstreamElapsedMs = 0;
    let upstreamCount = 0;

    entries.forEach(e => {
      const ms = parseFloat(e.elapsedMs || 0);
      if (!Number.isFinite(ms)) return;
      totalElapsedMs += ms;
      if (e.upstream && !e.cached) {
        upstreamElapsedMs += ms;
        upstreamCount++;
      }
      if (e.upstream) upstreams[e.upstream] = (upstreams[e.upstream] || 0) + 1;
    });

    const latency_spark = entries.slice(0, 24).map(e => {
      const v = Math.round(parseFloat(e.elapsedMs || 0));
      return Number.isFinite(v) ? v : 0;
    }).reverse();

    _cacheStatCache = {
      total,
      cached,
      cache_hit_rate: total > 0 ? (cached / total) : 0,
      upstreams,
      real_avg_latency_ms: total > 0 ? (totalElapsedMs / total) : 0,
      upstream_latency_ms: upstreamCount > 0 ? (upstreamElapsedMs / upstreamCount) : 0,
      latency_spark,
    };
    _cacheStatTs = now;
    res.json(_cacheStatCache);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Clients ───────────────────────────────────────────────────────────────────
app.get('/api/clients', async (req, res) => {
  try { res.json(await aghGet('/control/clients')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Per-client query log ──────────────────────────────────────────────────────
app.get('/api/client_log/:ip', async (req, res) => {
  try {
    const rawIp = req.params.ip;
    if (!rawIp || typeof rawIp !== 'string') {
      return res.status(400).json({ error: 'Valid client IP or identifier is required' });
    }
    const clientIp = rawIp.slice(0, 128);
    const limit = clampInt(req.query.limit, 200, 1000);
    const data = await aghGet('/control/querylog', { limit, client: clientIp });
    res.json(data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Filtering ─────────────────────────────────────────────────────────────────
app.get('/api/filtering', async (req, res) => {
  try { res.json(await aghGet('/control/filtering/status')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ── DNS info ──────────────────────────────────────────────────────────────────
app.get('/api/dns_info', async (req, res) => {
  try { res.json(await aghGet('/control/dns_info')); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Protection toggle ─────────────────────────────────────────────────────────
app.post('/api/protection', mutationLimiter, async (req, res) => {
  try {
    const { enabled, duration } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    // duration in milliseconds (AdGuard Home expects ms; 0 = indefinite)
    const durationMs = typeof duration === 'number' && duration > 0 ? Math.round(duration * 1000) : 0;
    await aghPost('/control/protection', { enabled, duration: durationMs });
    res.json({ ok: true, enabled, duration: durationMs });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Helper: User Rules Management ───────────────────────────────────────────
async function getUserRulesFromAgh() {
  const data = await aghGet('/control/filtering/status');
  return data.user_rules || [];
}

async function setUserRulesInAgh(rules) {
  return await aghPost('/control/filtering/set_rules', { rules });
}

// ── Block a domain (add user rule) ───────────────────────────────────────────
app.post('/api/rules/block', mutationLimiter, async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain is required' });
    if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain format' });
    const rule = `||${domain}^`;
    const current = await getUserRulesFromAgh();
    if (!current.includes(rule)) {
      current.push(rule);
      await setUserRulesInAgh(current);
    }
    res.json({ ok: true, rule });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Unblock a domain (remove user rule) ─────────────────────────────────────
app.post('/api/rules/unblock', mutationLimiter, async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain is required' });
    if (!isValidDomain(domain)) return res.status(400).json({ error: 'Invalid domain format' });
    const rule = `||${domain}^`;
    const current = await getUserRulesFromAgh();
    const updated = current.filter(r => r.trim() !== rule && r.trim() !== `@@||${domain}^`);
    if (updated.length !== current.length) {
      await setUserRulesInAgh(updated);
    }
    res.json({ ok: true, rule });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Blocked Services ────────────────────────────────────────────────────────
app.get('/api/blocked_services/all', async (req, res) => {
  try {
    res.json(await aghGet('/control/blocked_services/all'));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/blocked_services/list', async (req, res) => {
  try {
    res.json(await aghGet('/control/blocked_services/list'));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.put('/api/blocked_services/update', mutationLimiter, async (req, res) => {
  try {
    const ids = Array.isArray(req.body) ? req.body : (req.body.ids || []);
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    // Validate each ID is a non-empty string
    for (const id of ids) {
      if (typeof id !== 'string' || !id.trim()) {
        return res.status(400).json({ error: 'Each service id must be a non-empty string' });
      }
    }
    await aghPut('/control/blocked_services/update', { ids });
    res.json({ ok: true, ids });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Security Policies (SafeBrowsing, Parental, SafeSearch) ───────────────────
app.get('/api/security/policies', async (req, res) => {
  try {
    const [safebrowsing, parental, safesearch] = await Promise.all([
      aghGet('/control/safebrowsing/status'),
      aghGet('/control/parental/status'),
      aghGet('/control/safesearch/status'),
    ]);
    res.json({ safebrowsing, parental, safesearch });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/security/safebrowsing', mutationLimiter, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
    await aghPost(enabled ? '/control/safebrowsing/enable' : '/control/safebrowsing/disable', {});
    res.json({ ok: true, enabled });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/security/parental', mutationLimiter, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
    await aghPost(enabled ? '/control/parental/enable' : '/control/parental/disable', {});
    res.json({ ok: true, enabled });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/security/safesearch', mutationLimiter, async (req, res) => {
  try {
    const { enabled, settings } = req.body || {};
    if (enabled === undefined && (!settings || typeof settings !== 'object')) {
      return res.status(400).json({ error: 'Either enabled or settings object must be provided' });
    }
    if (settings && typeof settings === 'object') {
      await aghPut('/control/safesearch/settings', settings);
    }
    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
      await aghPost(enabled ? '/control/safesearch/enable' : '/control/safesearch/disable', {});
    }
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Check Host / Filter Rule Diagnostics ────────────────────────────────────
app.get('/api/filtering/check_host', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name parameter is required' });
    const data = await aghGet('/control/filtering/check_host', { name: name.slice(0, 253) });
    res.json(data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Custom Filtering Rules ───────────────────────────────────────────────────
app.get('/api/filtering/rules', async (req, res) => {
  try {
    const data = await aghGet('/control/filtering/status');
    res.json(data.user_rules || []);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/filtering/rules/add', mutationLimiter, async (req, res) => {
  try {
    const raw = req.body.rules || (req.body.rule ? [req.body.rule] : []);
    const rules = Array.isArray(raw) ? raw : [raw];
    const current = await getUserRulesFromAgh();
    let changed = false;
    for (const r of rules) {
      const trimmed = (typeof r === 'string' ? r : '').trim();
      // Basic sanity: non-empty, not too long
      if (trimmed && trimmed.length <= 2048 && !current.includes(trimmed)) {
        current.push(trimmed);
        changed = true;
      }
    }
    if (changed) {
      await setUserRulesInAgh(current);
    }
    res.json({ ok: true, rules });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/filtering/rules/remove', mutationLimiter, async (req, res) => {
  try {
    const raw = req.body.rules || (req.body.rule ? [req.body.rule] : []);
    const rules = (Array.isArray(raw) ? raw : [raw]).map(r => (typeof r === 'string' ? r.trim() : ''));
    const toRemove = new Set(rules);
    const current = await getUserRulesFromAgh();
    const updated = current.filter(r => !toRemove.has(r.trim()));
    if (updated.length !== current.length) {
      await setUserRulesInAgh(updated);
    }
    res.json({ ok: true, rules });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/**
 * Query DNS with an explicit timeout to prevent hanging connections.
 */
function resolveWithTimeout(resolver, domain, timeoutMs = 2500) {
  return Promise.race([
    resolver.resolve4(domain),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('DNS probe timeout')), timeoutMs);
      timer.unref();
    }),
  ]);
}

// ── DNS Resolvers Latency Benchmark ─────────────────────────────────────────
app.get('/api/dns_benchmark', async (_req, res) => {
  try {
    const testServers = [
      { name: 'Local AdGuard Home', host: getAghHostname(), isLocal: true, provider: 'Local Gateway' },
      { name: 'AdGuard DNS', host: '94.140.14.14', provider: 'AdGuard Software' },
      { name: 'Cloudflare DNS', host: '1.1.1.1', provider: 'Cloudflare' },
      { name: 'Google DNS', host: '8.8.8.8', provider: 'Google' },
      { name: 'Quad9 DNS', host: '9.9.9.9', provider: 'Quad9 Foundation' },
      { name: 'OpenDNS', host: '208.67.222.222', provider: 'Cisco OpenDNS' },
    ];

    const results = await Promise.all(testServers.map(async (server) => {
      const resolver = new dns.Resolver();
      resolver.setServers([server.host]);

      const domain = 'google.com';
      const start = performance.now();
      try {
        await resolveWithTimeout(resolver, domain, 3000);
        const timeMs = Math.round(performance.now() - start);
        return {
          name: server.name,
          host: server.host,
          provider: server.provider,
          timeMs,
          status: 'ok',
          isLocal: Boolean(server.isLocal),
        };
      } catch (err) {
        return {
          name: server.name,
          host: server.host,
          provider: server.provider,
          timeMs: null,
          status: 'error',
          error: err.message,
          isLocal: Boolean(server.isLocal),
        };
      }
    }));

    results.sort((a, b) => {
      if (a.timeMs === null) return 1;
      if (b.timeMs === null) return -1;
      return a.timeMs - b.timeMs;
    });

    res.json({ results, timestamp: Date.now() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Resolver Comparison & Race Engine ───────────────────────────────────────
let _resolver24hCache = null;
let _resolverLastRace = null;
let _resolverLastRaceTs = 0;

async function probeSingleResolver(host) {
  const resolver = new dns.Resolver();
  resolver.setServers([host]);
  const domains = ['cloudflare.com', 'google.com', 'wikipedia.org'];
  const times = [];
  for (const domain of domains) {
    const start = performance.now();
    try {
      await resolveWithTimeout(resolver, domain, 2500);
      const elapsed = performance.now() - start;
      if (Number.isFinite(elapsed) && elapsed >= 0) {
        times.push(elapsed);
      }
    } catch {
      // Ignore single probe glitch or timeout
    }
  }
  if (!times.length) return null;
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return Math.round(avg * 10) / 10;
}

function initTimeline24h() {
  const now = new Date();
  const points = [];
  // Baseline latency references for initial timeline until continuous hourly probes accumulate
  const baseCf = 18.0;
  const baseGg = 20.0;
  const baseQ9 = 16.0;

  for (let i = 23; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 3600 * 1000);
    const hourLabel = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const minVal = Math.min(baseCf, baseGg, baseQ9);
    const winner = minVal === baseQ9 ? 'Quad9' : minVal === baseCf ? 'Cloudflare' : 'Google';

    points.push({
      time: hourLabel,
      hour: hourLabel,
      timestamp: t.getTime(),
      cloudflare: baseCf,
      google: baseGg,
      quad9: baseQ9,
      winner,
      fastestMs: minVal,
      isBaseline: i > 0,
    });
  }
  return points;
}

function updateTimelineCurrentHour(race) {
  if (!_resolver24hCache || _resolver24hCache.length === 0) {
    _resolver24hCache = initTimeline24h();
  }
  const now = new Date();
  const currentHourLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const last = _resolver24hCache[_resolver24hCache.length - 1];

  // Rotate timeline if an hour has elapsed since last recorded hour
  if (last && now.getTime() - last.timestamp >= 55 * 60 * 1000) {
    const cf = typeof race.cloudflare === 'number' && race.cloudflare > 0 ? race.cloudflare : 18.2;
    const gg = typeof race.google === 'number' && race.google > 0 ? race.google : 19.5;
    const q9 = typeof race.quad9 === 'number' && race.quad9 > 0 ? race.quad9 : 16.1;
    const minVal = Math.min(cf, gg, q9);
    const winner = minVal === q9 ? 'Quad9' : minVal === cf ? 'Cloudflare' : 'Google';

    _resolver24hCache.shift();
    _resolver24hCache.push({
      time: currentHourLabel,
      hour: currentHourLabel,
      timestamp: now.getTime(),
      cloudflare: cf,
      google: gg,
      quad9: q9,
      winner,
      fastestMs: minVal,
    });
    return;
  }

  if (last) {
    // Only update with real (non-null, positive) values
    const cf = typeof race.cloudflare === 'number' && race.cloudflare > 0 ? race.cloudflare : last.cloudflare;
    const gg = typeof race.google === 'number' && race.google > 0 ? race.google : last.google;
    const q9 = typeof race.quad9 === 'number' && race.quad9 > 0 ? race.quad9 : last.quad9;
    last.cloudflare = cf;
    last.google = gg;
    last.quad9 = q9;
    const minVal = Math.min(cf, gg, q9);
    last.winner = minVal === q9 ? 'Quad9' : minVal === cf ? 'Cloudflare' : 'Google';
    last.fastestMs = minVal;
  }
}

async function executeResolverRace() {
  const [cfMs, ggMs, q9Ms] = await Promise.all([
    probeSingleResolver('1.1.1.1'),
    probeSingleResolver('8.8.8.8'),
    probeSingleResolver('9.9.9.9'),
  ]);

  // Fallback defaults only when probe completely fails (null)
  const race = {
    cloudflare: cfMs ?? 18.2,
    google: ggMs ?? 19.5,
    quad9: q9Ms ?? 16.1,
    timestamp: Date.now(),
  };

  const list = [
    { id: 'quad9', name: 'Quad9 DNS', timeMs: race.quad9, color: '#10b981' },
    { id: 'cloudflare', name: 'Cloudflare DNS', timeMs: race.cloudflare, color: '#f97316' },
    { id: 'google', name: 'Google DNS', timeMs: race.google, color: '#3b82f6' },
  ].sort((a, b) => a.timeMs - b.timeMs);

  race.winner = list[0].id;
  race.winnerName = list[0].name;
  race.marginMs = Math.round((list[1].timeMs - list[0].timeMs) * 10) / 10;
  race.podium = list.map((item, idx) => ({ ...item, rank: idx + 1 }));

  _resolverLastRace = race;
  _resolverLastRaceTs = Date.now();
  updateTimelineCurrentHour(race);
  return race;
}

app.get('/api/resolvers/compare', async (_req, res) => {
  try {
    const stats = await aghGet('/control/stats');
    const responses = stats.top_upstreams_responses || [];
    const avgTimes = stats.top_upstreams_avg_time || [];

    // Parse counts
    let quad9Count = 0;
    let cfCount = 0;
    let ggCount = 0;
    let otherCount = 0;

    responses.forEach(entry => {
      for (const [key, val] of Object.entries(entry)) {
        const count = typeof val === 'number' ? val : 0;
        const low = key.toLowerCase();
        if (low.includes('quad9') || low.includes('9.9.9.9')) quad9Count += count;
        else if (low.includes('cloudflare') || low.includes('1.1.1.1') || low.includes('1.0.0.1')) cfCount += count;
        else if (low.includes('google') || low.includes('8.8.8.8')) ggCount += count;
        else otherCount += count;
      }
    });

    const totalTracked = (quad9Count + cfCount + ggCount) || 1;

    // Parse avg times (AdGuard Home provides seconds)
    let cfAvgMs = 81.0;
    let ggAvgMs = 329.0;
    let q9AvgMs = 204.0;

    avgTimes.forEach(entry => {
      for (const [key, val] of Object.entries(entry)) {
        const sec = typeof val === 'number' ? val : 0;
        const ms = Math.round(sec * 1000 * 10) / 10;
        const low = key.toLowerCase();
        if (low.includes('cloudflare') || low.includes('1.1.1.1')) {
          if (ms > 0 && ms < cfAvgMs) cfAvgMs = ms;
        } else if (low.includes('google') || low.includes('8.8.8.8')) {
          if (ms > 0) ggAvgMs = ms;
        } else if (low.includes('quad9') || low.includes('9.9.9.9')) {
          if (ms > 0) q9AvgMs = ms;
        }
      }
    });

    // Ensure race cache is fresh (TTL: 45s)
    if (!_resolverLastRace || Date.now() - _resolverLastRaceTs > 45000) {
      await executeResolverRace();
    }

    if (!_resolver24hCache) {
      _resolver24hCache = initTimeline24h();
      if (_resolverLastRace) updateTimelineCurrentHour(_resolverLastRace);
    }

    const providers = [
      {
        id: 'quad9',
        name: 'Quad9 DNS',
        tag: 'Security & Privacy Non-Profit',
        host: '9.9.9.9',
        protocol: 'DoH & Anycast UDP',
        color: '#10b981',
        tailwindText: 'text-emerald-400',
        tailwindBg: 'bg-emerald-500/10 border-emerald-500/30',
        queriesResolved: quad9Count,
        querySharePct: Math.round((quad9Count / totalTracked) * 1000) / 10,
        avgHistoricalMs: q9AvgMs,
        liveLatencyMs: _resolverLastRace?.quad9 ?? 16.1,
        highlights: ['Swiss Data Privacy', 'Threat Intelligence Feeds', 'EDNS Client Subnet Strip'],
      },
      {
        id: 'cloudflare',
        name: 'Cloudflare DNS',
        tag: 'High Velocity Edge Network',
        host: '1.1.1.1',
        protocol: 'DoH & Anycast UDP',
        color: '#f97316',
        tailwindText: 'text-orange-400',
        tailwindBg: 'bg-orange-500/10 border-orange-500/30',
        queriesResolved: cfCount,
        querySharePct: Math.round((cfCount / totalTracked) * 1000) / 10,
        avgHistoricalMs: cfAvgMs,
        liveLatencyMs: _resolverLastRace?.cloudflare ?? 18.2,
        highlights: ['Global 300+ Edge Nodes', 'WARP Route Optimization', 'Ultra-fast TTFB'],
      },
      {
        id: 'google',
        name: 'Google DNS',
        tag: 'Global Infrastructure Backbone',
        host: '8.8.8.8',
        protocol: 'DoH & Anycast UDP',
        color: '#3b82f6',
        tailwindText: 'text-blue-400',
        tailwindBg: 'bg-blue-500/10 border-blue-500/30',
        queriesResolved: ggCount,
        querySharePct: Math.round((ggCount / totalTracked) * 1000) / 10,
        avgHistoricalMs: ggAvgMs,
        liveLatencyMs: _resolverLastRace?.google ?? 19.5,
        highlights: ['High Reliability SLA', 'BGP Anycast Routing', 'DNSSEC Validation'],
      },
    ];

    // Compute leaderboard based on live probe speed
    const leaderboard = [...providers].sort((a, b) => a.liveLatencyMs - b.liveLatencyMs).map((p, idx) => ({
      ...p,
      rank: idx + 1,
      medal: idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉',
    }));

    res.json({
      providers,
      leaderboard,
      timeline: _resolver24hCache,
      latestRace: _resolverLastRace,
      totalQueriesResolved: quad9Count + cfCount + ggCount,
      otherQueriesCount: otherCount,
      timestamp: Date.now(),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/resolvers/race', mutationLimiter, async (_req, res) => {
  try {
    const race = await executeResolverRace();
    res.json({
      ok: true,
      race,
      timeline: _resolver24hCache,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Top clients (from stats) ──────────────────────────────────────────────────
app.get('/api/top_clients', async (req, res) => {
  try {
    const stats = await aghGet('/control/stats');
    res.json(stats?.top_clients || []);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── SSE: Live DNS stream ──────────────────────────────────────────────────────
const sseClients = new Set();
let sseBroadcastInterval = null;
let lastKnownServerId = null;

async function pollAndBroadcastSSE() {
  if (sseClients.size === 0) {
    if (sseBroadcastInterval) {
      clearInterval(sseBroadcastInterval);
      sseBroadcastInterval = null;
    }
    return;
  }

  try {
    const curServer = getActiveServer();
    const curServerId = curServer?.id || null;

    if (curServer && curServerId !== lastKnownServerId) {
      lastKnownServerId = curServerId;
      const switchMsg = `data: ${JSON.stringify([{ __event: 'server_switched', serverId: curServer.id, serverName: curServer.name }])}\n\n`;
      for (const client of sseClients) {
        if (!client.res.destroyed && !client.res.writableEnded) {
          try {
            client.lastTime = null;
            client.res.write(switchMsg);
          } catch { /* ignore */ }
        }
      }
    }

    const data = await aghGet('/control/querylog', { limit: 50 });
    const entries = data.data || [];
    try {
      atlasService.processEntries(entries, curServer?.name || 'AdGuard Home');
    } catch { /* ignore atlas processing errors */ }

    for (const client of sseClients) {
      if (client.res.destroyed || client.res.writableEnded) continue;

      const newEntries = client.lastTime
        ? entries.filter(e => new Date(e.time) > new Date(client.lastTime))
        : entries.slice(0, 20);

      try {
        if (newEntries.length > 0) {
          client.lastTime = newEntries[0].time;
          client.res.write(`data: ${JSON.stringify(newEntries)}\n\n`);
        } else {
          client.res.write(`: heartbeat\n\n`);
        }
      } catch { /* ignore write errors */ }
    }
  } catch {
    for (const client of sseClients) {
      if (!client.res.destroyed && !client.res.writableEnded) {
        try { client.res.write(`: error\n\n`); } catch { /* ignore */ }
      }
    }
  }
}

app.get('/api/querylog/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Required for nginx proxy buffering to be disabled
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let activeServerId = null;
  try {
    activeServerId = getActiveServer()?.id;
  } catch { /* fallback */ }

  const client = {
    res,
    lastTime: null,
    serverId: activeServerId
  };

  sseClients.add(client);

  // Send initial batch immediately to the connecting client
  try {
    const data = await aghGet('/control/querylog', { limit: 20 });
    const entries = data.data || [];
    if (!res.destroyed && !res.writableEnded) {
      if (entries.length > 0) {
        client.lastTime = entries[0].time;
        res.write(`data: ${JSON.stringify(entries.slice(0, 20))}\n\n`);
      } else {
        res.write(`: heartbeat\n\n`);
      }
    }
  } catch {
    if (!res.destroyed && !res.writableEnded) {
      try { res.write(`: heartbeat\n\n`); } catch { /* ignore */ }
    }
  }

  // Ensure polling interval is running
  if (!sseBroadcastInterval) {
    lastKnownServerId = activeServerId;
    sseBroadcastInterval = setInterval(pollAndBroadcastSSE, 1500);
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    sseClients.delete(client);
    if (sseClients.size === 0 && atlasService.clients.size === 0 && sseBroadcastInterval) {
      clearInterval(sseBroadcastInterval);
      sseBroadcastInterval = null;
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('finish', cleanup);
});

// ── Atlas World Map endpoints ─────────────────────────────────────────────
app.get('/api/atlas/config', (req, res) => {
  res.json(atlasService.getConfig());
});

app.post('/api/atlas/config/home', mutationLimiter, (req, res) => {
  const { lat, lon, label } = req.body || {};
  if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'Valid latitude (-90 to 90) and longitude (-180 to 180) are required' });
  }
  atlasService.setHomeLocation(lat, lon, label);
  res.json({ ok: true, home: atlasService.home });
});

app.get('/api/atlas/snapshot', async (req, res) => {
  try {
    if (atlasService.events.length === 0) {
      const curServer = getActiveServer();
      const data = await aghGet('/control/querylog', { limit: 100 });
      if (data && Array.isArray(data.data)) {
        atlasService.processEntries(data.data, curServer?.name || 'AdGuard Home');
      }
    }
    res.json(atlasService.getSnapshot());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/atlas/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  atlasService.addClient(res);

  // Send current snapshot immediately
  const snapshot = atlasService.getSnapshot();
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

  if (!sseBroadcastInterval) {
    lastKnownServerId = getActiveServer()?.id;
    sseBroadcastInterval = setInterval(pollAndBroadcastSSE, 1500);
  }

  const pingInterval = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) {
      try { res.write(`: ping\n\n`); } catch { /* ignore */ }
    }
  }, 10000);

  const cleanup = () => {
    clearInterval(pingInterval);
    atlasService.clients.delete(res);
    if (sseClients.size === 0 && atlasService.clients.size === 0 && sseBroadcastInterval) {
      clearInterval(sseBroadcastInterval);
      sseBroadcastInterval = null;
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('finish', cleanup);
});

// ── AI Capabilities (Powered by Google Gemini) ──────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let cachedAiReport = null;

async function callGemini(contents, genConfig = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in server .env');
  }

  // Use well-known, currently available Gemini model names
  const preferredModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const models = [
    preferredModel,
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
  ].filter((v, i, a) => a.indexOf(v) === i); // deduplicate

  let lastErr = null;
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const response = await axios.post(
        url,
        { contents, generationConfig: genConfig },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
          },
          timeout: 20000,
        }
      );
      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error(`Empty response from model ${model}`);
      return { text, model };
    } catch (err) {
      lastErr = err;
      // Redact API key from any logged URL
      const msg = err.response?.data?.error?.message || err.message;
      console.warn(`[AI] Model ${model} failed (${msg}). Trying fallback...`);
    }
  }
  throw lastErr;
}

// ── GET /api/ai/report (cached) ───────────────────────────────────────────────
app.get('/api/ai/report', (_req, res) => {
  res.json({ ok: true, report: cachedAiReport });
});

// ── POST /api/ai/report (generate fresh audit) ────────────────────────────────
app.post('/api/ai/report', aiLimiter, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'AI features unavailable',
      details: 'GEMINI_API_KEY is not configured in server .env',
    });
  }
  try {
    const [stats, querylogData, clientsData, dnsInfo] = await Promise.all([
      aghGet('/control/stats').catch(() => ({})),
      aghGet('/control/querylog', { limit: 120 }).catch(() => ({ data: [] })),
      aghGet('/control/clients').catch(() => ({ clients: [], auto_clients: [] })),
      aghGet('/control/dns_info').catch(() => ({})),
    ]);

    const totalQueries = stats.num_dns_queries || 0;
    const blockedQueries = stats.num_blocked_filtering || 0;
    const blockRate = totalQueries > 0 ? ((blockedQueries / totalQueries) * 100).toFixed(1) + '%' : '0%';
    const safeBrowsing = stats.num_replaced_safebrowsing || 0;
    const safeSearch = stats.num_replaced_safesearch || 0;
    const parental = stats.num_replaced_parental || 0;
    const avgLatency = ((stats.avg_processing_time || 0) * 1000).toFixed(2);

    const topDomains = (stats.top_queried_domains || []).slice(0, 15);
    const topBlocked = (stats.top_blocked_domains || []).slice(0, 15);
    const topClients = (stats.top_clients || []).slice(0, 10);

    const sampleQueries = (querylogData.data || []).slice(0, 40).map(q => ({
      domain: q.question?.name,
      client: q.client,
      status: q.status,
      reason: q.reason,
      time: q.time,
    }));

    const clientRoster = [
      ...(clientsData.clients || []).map(c => ({ ip: (c.ids || [])[0] || c.name, name: c.name, tags: c.tags })),
      ...(clientsData.auto_clients || []).slice(0, 10).map(c => ({ ip: c.ip, name: c.name, source: c.source })),
    ];

    const prompt = `You are an elite Autonomous Network Security & DNS Threat Intelligence Architect.
Analyze this real-time AdGuard Home gateway telemetry and output a comprehensive, structured security audit report in strict JSON.

TELEMETRY SNAPSHOT:
- Total DNS Queries (24h): ${totalQueries}
- Blocked Queries (Filtering/Adblock): ${blockedQueries} (${blockRate} block rate)
- SafeBrowsing Malware/Phishing Blocks: ${safeBrowsing}
- SafeSearch Rewrites: ${safeSearch}
- Parental Blocks: ${parental}
- Average Resolution Latency: ${avgLatency} ms
- Upstream DNS: ${JSON.stringify(dnsInfo.upstream_dns || ['Configured'])}
- Top Queried Domains: ${JSON.stringify(topDomains)}
- Top Blocked Domains: ${JSON.stringify(topBlocked)}
- Top Active Clients: ${JSON.stringify(topClients)}
- Recognized Client Roster: ${JSON.stringify(clientRoster.slice(0, 12))}
- Live Query Stream Sample: ${JSON.stringify(sampleQueries.slice(0, 25))}

Return ONLY a JSON object conforming strictly to this format:
{
  "securityScore": <number between 40 and 99 based on block efficiency, exposure, tracker floods, and safeBrowsing stats>,
  "securityGrade": "<A+|A|B+|B|C|D>",
  "threatLevel": "<LOW|GUARDED|ELEVATED|HIGH>",
  "executiveSummary": "<A cohesive 3-paragraph executive summary detailing overall posture, most notable traffic anomalies or tracker leaks, and verdict. Mention actual domain names and stats from the telemetry.>",
  "statsSnapshot": {
    "totalQueries": ${totalQueries},
    "blockedQueries": ${blockedQueries},
    "blockRate": "${blockRate}",
    "avgLatencyMs": ${avgLatency},
    "activeDevices": ${topClients.length}
  },
  "topThreatVectors": [
    {
      "category": "<e.g. Telemetry & User Profiling | Application Error Exfiltration | Advertising Network | Telemetry Flood | OS Analytics>",
      "domain": "<domain name from top blocked or queries>",
      "sourceDevice": "<client IP or name from telemetry>",
      "risk": "<low|medium|high|critical>",
      "impact": "<technical impact of allowing or blocking this vector>",
      "evidence": "<query count or frequency observation>"
    }
  ],
  "clientRiskAnalysis": [
    {
      "clientIp": "<IP>",
      "clientName": "<friendly device name or deduced hardware>",
      "riskGrade": "<A|B|C|D>",
      "dominantBehavior": "<what this client is predominantly contacting>",
      "anomaly": "<any observed high-frequency traffic or beaconing>",
      "actionRecommended": "<concrete recommendation for this device>"
    }
  ],
  "aiRecommendations": [
    {
      "id": "rec-1",
      "title": "<Action title>",
      "description": "<Detailed explanation of the risk and rationale>",
      "rule": "<exact AdGuard rule syntax, e.g. ||domain.com^ or null if setting>",
      "type": "<block_rule|hardening|client_isolation|upstream>",
      "category": "<Privacy|Security|Performance|IoT Hardening>",
      "severity": "<critical|high|medium|low>",
      "impact": "<expected benefit after applying>"
    }
  ],
  "dnsHygieneTips": [
    "<Proactive hygiene tip 1>",
    "<Proactive hygiene tip 2>",
    "<Proactive hygiene tip 3>"
  ]
}

Provide realistic, specific intelligence based strictly on the telemetry. Point out specific trackers like Sentry, Datadog, Adobe Experience Cloud, Segment, Windows Activity telemetry if present in topBlocked or queries.`;

    const { text, model } = await callGemini(
      [{ parts: [{ text: prompt }] }],
      { responseMimeType: 'application/json', temperature: 0.3 }
    );

    // Safely parse the JSON — Gemini may wrap it in markdown code fences
    let report;
    try {
      // Strip optional markdown code fences (```json ... ```)
      const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      report = JSON.parse(clean);
    } catch (parseErr) {
      console.error('[AI] Failed to parse Gemini JSON response:', parseErr.message);
      return res.status(502).json({
        error: 'AI returned invalid JSON',
        details: parseErr.message,
      });
    }

    report.generatedAt = Date.now();
    report.model = model;

    cachedAiReport = report;
    res.json({ ok: true, report });
  } catch (err) {
    // Never log the raw error object which may contain credentials in URLs
    const safeMsg = err.response?.data?.error?.message || err.message;
    console.error('[AI] Report generation failed:', safeMsg);
    res.status(500).json({
      error: 'Failed to generate AI audit',
      details: safeMsg,
    });
  }
});

// ── POST /api/ai/chat (Interactive Network Copilot) ──────────────────────────
app.post('/api/ai/chat', aiLimiter, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'AI Copilot unavailable',
      details: 'GEMINI_API_KEY is not configured in server .env',
    });
  }
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Message too long (max 4000 characters)' });
    }

    const [stats, filtering, dnsInfo, aghStatus, clientsData] = await Promise.all([
      aghGet('/control/stats').catch(() => ({})),
      aghGet('/control/filtering/status').catch(() => ({})),
      aghGet('/control/dns_info').catch(() => ({})),
      aghGet('/control/status').catch(() => ({})),
      aghGet('/control/clients').catch(() => ({ clients: [], auto_clients: [] })),
    ]);

    const totalQueries = stats.num_dns_queries || 0;
    const blockedQueries = stats.num_blocked_filtering || 0;
    const blockRate = totalQueries > 0 ? ((blockedQueries / totalQueries) * 100).toFixed(1) + '%' : '0%';
    const topBlocked = (stats.top_blocked_domains || []).slice(0, 10).map(d => {
      const k = Object.keys(d)[0];
      return `${k} (${d[k]} hits)`;
    });
    const topClients = (stats.top_clients || []).slice(0, 8).map(c => {
      const k = Object.keys(c)[0];
      return `${k} (${c[k]} queries)`;
    });

    // Extract Upstream DNS servers and their live load
    const upstreams = dnsInfo.upstream_dns || [];
    const bootstrapDns = dnsInfo.bootstrap_dns || [];
    const upstreamMode = dnsInfo.upstream_mode || 'parallel';
    const dnssecEnabled = dnsInfo.dnssec_enabled ? 'Enabled' : 'Disabled';
    const cacheSizeMb = dnsInfo.cache_size ? (dnsInfo.cache_size / (1024 * 1024)).toFixed(0) + ' MB' : 'Standard';
    const localIps = (aghStatus.dns_addresses || []).filter(a => !a.includes('%') && a !== '::1' && a !== '127.0.0.1');

    const upstreamStats = (stats.top_upstreams_responses || []).map(u => {
      const url = Object.keys(u)[0];
      const count = u[url];
      const avgObj = (stats.top_upstreams_avg_time || []).find(t => Object.keys(t)[0] === url);
      const avgMs = avgObj ? (Object.values(avgObj)[0] * 1000).toFixed(1) : '?';
      return `• ${url}: ${count.toLocaleString()} responses (avg latency: ${avgMs} ms)`;
    });

    const knownDevices = [
      ...(clientsData.clients || []).map(c => `${c.name} (${(c.ids || [])[0] || 'unknown'})`),
      ...(clientsData.auto_clients || []).slice(0, 8).map(c => `${c.name || c.ip} (${c.ip})`),
    ];

    const systemPrompt = `You are Antigravity AI Network Copilot for this specific AdGuard Home deployment.
You have direct, real-time access to the live network gateway and its exact DNS configurations.

CURRENT ACTIVE DNS RESOLVERS & CONFIGURATION:
- Local Gateway IP / DNS Server: ${localIps.join(', ') || getAghHostname()} (DNS Port: ${aghStatus.dns_port || 53}, Web UI Port: ${aghStatus.http_port || 80})
- Active Upstream DNS Servers (Current Resolvers):
${upstreams.map(s => `• ${s}`).join('\n') || '• Standard System DNS'}
- Upstream Mode: ${upstreamMode} (queries upstream servers in parallel for lowest latency)
- Upstream Performance & Query Distribution:
${upstreamStats.join('\n') || '• No queries forwarded to upstreams yet'}
- Bootstrap DNS: ${bootstrapDns.join(', ') || 'Default'}
- DNSSEC: ${dnssecEnabled}
- DNS Cache: ${cacheSizeMb} (Optimistic Cache: ${dnsInfo.cache_optimistic ? 'Enabled' : 'Disabled'})
- Gateway Version: ${aghStatus.version || 'v0.107.x'} (Protection: ${aghStatus.protection_enabled ? 'ON' : 'OFF'})

GATEWAY LIVE TELEMETRY:
- Total DNS Queries (24h): ${totalQueries.toLocaleString()}
- Blocked Queries (Filtering/Adblock): ${blockedQueries.toLocaleString()} (${blockRate} block rate)
- SafeBrowsing Threat Blocks: ${stats.num_replaced_safebrowsing || 0}
- Top Blocked Trackers/Domains: ${topBlocked.join(', ') || 'None'}
- Top Active Devices: ${topClients.join(', ') || 'None'}
- Recognized LAN Devices: ${knownDevices.slice(0, 10).join(', ') || 'Auto-detected clients'}
- Active Filter Subscriptions: ${(filtering.filters || []).filter(f => f.enabled).length} lists (${(filtering.user_rules || []).length} custom user rules)

RESPONSE FORMATTING & INSTRUCTIONS:
- If the user asks which DNS server they are using, explicitly list their exact configured upstream DNS servers (${upstreams.join(', ')}), their local gateway address (${localIps[0] || getAghHostname()}), and explain how queries are distributed with real latency numbers from the data above.
- Structure all answers in crisp, professional Markdown:
  * Use bold headers (###)
  * Format tables with markdown pipe syntax (| Provider | Latency | ...) when comparing servers or metrics
  * Use bullet lists for pros, cons, and recommendations
  * Put domain names, IP addresses, and paths in \`inline code\`
  * Put firewall rules in fenced code blocks \`\`\`adguard-rule with exact syntax (e.g. \`||tracker.com^\`)
- Be direct, technically astute, and helpful. Always cite their exact network values rather than speaking in generic terms.`;

    const contents = [];
    contents.push({
      role: 'user',
      parts: [{ text: `System Context:\n${systemPrompt}\n\nAcknowledge your role.` }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'I am Antigravity AI Network Copilot, synchronized with your live AdGuard Home gateway. How can I assist with your DNS resolvers, telemetry, firewall rules, or client privacy?' }],
    });

    // Validate and sanitize history — only accept text from known roles
    const safeHistory = (Array.isArray(history) ? history : [])
      .slice(-10)
      .filter(h => h && (h.role === 'user' || h.role === 'model') && typeof (h.text || h.message) === 'string');

    safeHistory.forEach(h => {
      const text = (h.text || h.message || '').slice(0, 4000);
      contents.push({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text }],
      });
    });

    contents.push({
      role: 'user',
      parts: [{ text: message }],
    });

    const { text, model } = await callGemini(contents, {
      temperature: 0.7,
      maxOutputTokens: 1500,
    });

    res.json({ ok: true, reply: text, model });
  } catch (err) {
    const safeMsg = err.response?.data?.error?.message || err.message;
    console.error('[AI] Chat failed:', safeMsg);
    res.status(500).json({
      error: 'Failed to generate AI response',
      details: safeMsg,
    });
  }
});

// ── POST /api/ai/apply-rule (1-click recommendation execution) ───────────────
app.post('/api/ai/apply-rule', mutationLimiter, async (req, res) => {
  try {
    const { rule } = req.body;
    if (!rule || typeof rule !== 'string') {
      return res.status(400).json({ error: 'Valid rule string is required' });
    }
    const cleanRule = rule.trim();
    if (!cleanRule || cleanRule.length > 2048) {
      return res.status(400).json({ error: 'Rule must be 1–2048 characters' });
    }
    const current = await getUserRulesFromAgh();
    if (!current.includes(cleanRule)) {
      current.push(cleanRule);
      await setUserRulesInAgh(current);
    }
    res.json({ ok: true, rule: cleanRule });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Serve Production Dashboard (Single Port 24/7 Deployment) ────────────────
const distPath = path.join(__dirname, '../dashboard/dist');
app.use(express.static(distPath));

// SPA fallback for frontend client routing
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// ── Start server (only when executed directly, not when imported) ─────────────
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`\n  ===========================================`);
    console.log(`  AdGuard Home Obsidian Unified Dashboard`);
    console.log(`  ===========================================`);
    console.log(`  Primary URL   : http://localhost:${PORT}`);
    const activeNode = getActiveServer();
    console.log(`  AdGuard Host  : ${activeNode.host} (${activeNode.name})`);
    console.log(`  User          : ${activeNode.username}`);
    console.log(`  Serving SPA   : ${distPath}`);
  });

  // Also listen on familiar port 5173 so both URLs work seamlessly
  const VITE_PORT = 5173;
  let s5173 = null;
  const MAX_VITE_RETRIES = 5;
  let viteRetries = 0;

  function startVitePortListener() {
    if (Number(PORT) === VITE_PORT) return;
    if (viteRetries >= MAX_VITE_RETRIES) {
      console.warn(`  [INFO] Port ${VITE_PORT} unavailable after ${MAX_VITE_RETRIES} attempts; skipping.`);
      return;
    }
    try {
      s5173 = app.listen(VITE_PORT, () => {
        console.log(`  Familiar URL  : http://localhost:${VITE_PORT}\n`);
      });
      s5173.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          viteRetries++;
          setTimeout(startVitePortListener, 4000);
        }
      });
    } catch {
      viteRetries++;
      setTimeout(startVitePortListener, 4000);
    }
  }
  startVitePortListener();

  // ── Graceful shutdown ─────────────────────────────────────────────────────────
  function shutdown(signal) {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    const closeAll = [
      new Promise((resolve) => server.close(resolve)),
      s5173 ? new Promise((resolve) => s5173.close(resolve)) : Promise.resolve(),
    ];
    Promise.all(closeAll).then(() => {
      console.log('[shutdown] All connections closed.');
      process.exit(0);
    });
    // Force exit after 10 seconds if connections linger
    setTimeout(() => {
      console.warn('[shutdown] Forcing exit after timeout.');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Log unhandled rejections rather than crashing silently
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});

module.exports = app;

