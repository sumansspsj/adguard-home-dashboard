/**
 * server/index.test.js
 *
 * Regression and security tests for the AdGuard Home proxy server.
 * These tests mock the upstream AdGuard Home API (axios) so they run
 * without a live AdGuard Home instance.
 *
 * Run with: npm test
 */

'use strict';

// ── Environment setup (must come before any require of the server) ────────────
process.env.AGH_HOST = 'http://127.0.0.1:3000';
process.env.AGH_USERNAME = 'admin';
process.env.AGH_PASSWORD = 'testpassword';
process.env.PORT = '0'; // random port — avoid conflicts
process.env.GEMINI_API_KEY = 'test-key';

// ── Mock axios before loading the server ─────────────────────────────────────
jest.mock('axios');
const axios = require('axios');

// ── Mock dns.promises to avoid real network calls ─────────────────────────────
jest.mock('dns', () => {
  const actual = jest.requireActual('dns');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      Resolver: class MockResolver {
        setServers() {}
        async resolve4() {
          return ['1.2.3.4'];
        }
      },
    },
  };
});

const request = require('supertest');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal mock for axios.get */
function mockAghGet(responseData) {
  axios.get.mockResolvedValue({ data: responseData });
}

/** Build a minimal mock for axios.post */
function mockAghPost(responseData = {}) {
  axios.post.mockResolvedValue({ data: responseData });
}

/** Make axios.get throw an error (simulates AGH offline) */
function mockAghGetError(message = 'connect ECONNREFUSED') {
  axios.get.mockRejectedValue(new Error(message));
}

// ── Load app after mocks are in place ─────────────────────────────────────────
// We require here (not at top-level) so that the jest.mock calls above
// take effect before module evaluation.
let app;
beforeAll(() => {
  // Silence startup console output
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  app = require('./index');
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/health', () => {
  it('returns ok:true and a timestamp', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.ts).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Status proxy
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/status', () => {
  it('proxies AdGuard Home status', async () => {
    const payload = { running: true, version: 'v0.107.1' };
    mockAghGet(payload);
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(payload);
  });

  it('returns 502 when AGH is unreachable', async () => {
    mockAghGetError();
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Query log parameter clamping
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/querylog — parameter clamping', () => {
  it('accepts valid limit and offset', async () => {
    mockAghGet({ data: [], oldest: '', total: 0 });
    const res = await request(app).get('/api/querylog?limit=50&offset=100');
    expect(res.status).toBe(200);
    // Verify axios was called with clamped params
    const callParams = axios.get.mock.calls[0][1].params;
    expect(callParams.limit).toBe(50);
    expect(callParams.offset).toBe(100);
  });

  it('clamps limit to 1000 when caller passes huge value', async () => {
    mockAghGet({ data: [], oldest: '', total: 0 });
    const res = await request(app).get('/api/querylog?limit=999999');
    expect(res.status).toBe(200);
    const callParams = axios.get.mock.calls[0][1].params;
    expect(callParams.limit).toBe(1000);
  });

  it('uses default limit 200 for invalid/negative value', async () => {
    mockAghGet({ data: [], oldest: '', total: 0 });
    const res = await request(app).get('/api/querylog?limit=-5');
    expect(res.status).toBe(200);
    const callParams = axios.get.mock.calls[0][1].params;
    expect(callParams.limit).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Protection toggle — input validation
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/protection', () => {
  it('accepts enabled:true', async () => {
    mockAghPost({});
    const res = await request(app).post('/api/protection').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects non-boolean enabled', async () => {
    const res = await request(app).post('/api/protection').send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('rejects missing enabled field', async () => {
    const res = await request(app).post('/api/protection').send({});
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Block / Unblock — domain validation
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/rules/block', () => {
  it('blocks a valid domain', async () => {
    axios.get.mockResolvedValue({ data: { user_rules: [] } });
    axios.post.mockResolvedValue({ data: {} });
    const res = await request(app).post('/api/rules/block').send({ domain: 'tracker.example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rule).toBe('||tracker.example.com^');
  });

  it('rejects missing domain', async () => {
    const res = await request(app).post('/api/rules/block').send({});
    expect(res.status).toBe(400);
  });

  it('rejects domain with injection characters', async () => {
    const res = await request(app)
      .post('/api/rules/block')
      .send({ domain: 'evil.com/../../etc/passwd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid domain/i);
  });

  it('rejects domain with spaces', async () => {
    const res = await request(app)
      .post('/api/rules/block')
      .send({ domain: 'bad domain.com' });
    expect(res.status).toBe(400);
  });

  it('does not add duplicate rule', async () => {
    const existingRule = '||tracker.example.com^';
    axios.get.mockResolvedValue({ data: { user_rules: [existingRule] } });
    const res = await request(app).post('/api/rules/block').send({ domain: 'tracker.example.com' });
    expect(res.status).toBe(200);
    // setRules should NOT have been called (post not invoked for rule update)
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('POST /api/rules/unblock', () => {
  it('rejects invalid domain characters', async () => {
    const res = await request(app)
      .post('/api/rules/unblock')
      .send({ domain: '; DROP TABLE users; --' });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocked services update — validation
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/blocked_services/update', () => {
  it('accepts an array of valid service ids', async () => {
    axios.put.mockResolvedValue({ data: {} });
    const res = await request(app)
      .put('/api/blocked_services/update')
      .send({ ids: ['youtube', 'netflix'] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects ids containing empty strings', async () => {
    const res = await request(app)
      .put('/api/blocked_services/update')
      .send({ ids: ['youtube', ''] });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security policy toggles — boolean validation
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/security/safebrowsing', () => {
  it('rejects non-boolean enabled', async () => {
    const res = await request(app)
      .post('/api/security/safebrowsing')
      .send({ enabled: 'true' });
    expect(res.status).toBe(400);
  });

  it('accepts boolean enabled:false', async () => {
    mockAghPost({});
    const res = await request(app)
      .post('/api/security/safebrowsing')
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /api/security/parental', () => {
  it('rejects string enabled', async () => {
    const res = await request(app)
      .post('/api/security/parental')
      .send({ enabled: 1 });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Check host — name required
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/filtering/check_host', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app).get('/api/filtering/check_host');
    expect(res.status).toBe(400);
  });

  it('proxies the check when name is present', async () => {
    mockAghGet({ reason: 'NotFilteredNotFound', rule: '', service_name: '', cname: '' });
    const res = await request(app).get('/api/filtering/check_host?name=example.com');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reason');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI chat — input validation
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/ai/chat', () => {
  it('returns 400 when message is missing', async () => {
    const res = await request(app).post('/api/ai/chat').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message is required/i);
  });

  it('returns 400 when message is not a string', async () => {
    const res = await request(app).post('/api/ai/chat').send({ message: 42 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when message exceeds 4000 chars', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .send({ message: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI apply-rule — validation
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/ai/apply-rule', () => {
  it('returns 400 when rule is missing', async () => {
    const res = await request(app).post('/api/ai/apply-rule').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for rule that is not a string', async () => {
    const res = await request(app).post('/api/ai/apply-rule').send({ rule: 123 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for rule exceeding 2048 chars', async () => {
    axios.get.mockResolvedValue({ data: { user_rules: [] } });
    const res = await request(app)
      .post('/api/ai/apply-rule')
      .send({ rule: '||' + 'x'.repeat(2050) + '^' });
    expect(res.status).toBe(400);
  });

  it('applies a valid rule without duplicate', async () => {
    axios.get.mockResolvedValue({ data: { user_rules: [] } });
    axios.post.mockResolvedValue({ data: {} });
    const res = await request(app)
      .post('/api/ai/apply-rule')
      .send({ rule: '||bad-tracker.net^' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('does not duplicate an already-existing rule', async () => {
    axios.get.mockResolvedValue({ data: { user_rules: ['||bad-tracker.net^'] } });
    const res = await request(app)
      .post('/api/ai/apply-rule')
      .send({ rule: '||bad-tracker.net^' });
    expect(res.status).toBe(200);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security headers
// ─────────────────────────────────────────────────────────────────────────────
describe('Security headers', () => {
  it('sets X-Content-Type-Options', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('sets Content-Security-Policy', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 for unknown API routes
// ─────────────────────────────────────────────────────────────────────────────
describe('Unknown API routes', () => {
  it('returns 404 JSON for /api/nonexistent', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache stats — NaN guard
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/cache_stats', () => {
  it('returns numeric values even when elapsedMs is missing', async () => {
    mockAghGet({
      data: [
        { cached: false, elapsedMs: '', upstream: '1.1.1.1' },
        { cached: true, elapsedMs: null, upstream: null },
        { cached: false, elapsedMs: '12.5', upstream: '8.8.8.8' },
      ],
    });
    const res = await request(app).get('/api/cache_stats');
    expect(res.status).toBe(200);
    expect(Number.isFinite(res.body.real_avg_latency_ms)).toBe(true);
    expect(Number.isFinite(res.body.upstream_latency_ms)).toBe(true);
    expect(Number.isFinite(res.body.cache_hit_rate)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stats config validation
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/stats/config', () => {
  it('rejects interval of 0', async () => {
    const res = await request(app).post('/api/stats/config').send({ interval: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects negative interval', async () => {
    const res = await request(app).post('/api/stats/config').send({ interval: -5 });
    expect(res.status).toBe(400);
  });

  it('accepts valid interval', async () => {
    mockAghPost({});
    const res = await request(app).post('/api/stats/config').send({ interval: 7 });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Querylog config validation
// ─────────────────────────────────────────────────────────────────────────────
describe('GET and POST /api/querylog/config', () => {
  it('GET /api/querylog/config returns querylog config info', async () => {
    mockAghGet({ interval: 90, enabled: true });
    const res = await request(app).get('/api/querylog/config');
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe(90);
  });

  it('POST /api/querylog/config rejects interval < 1', async () => {
    const res = await request(app).post('/api/querylog/config').send({ interval: 0 });
    expect(res.status).toBe(400);
  });

  it('POST /api/querylog/config accepts valid retention interval', async () => {
    mockAghPost({});
    const res = await request(app).post('/api/querylog/config').send({ interval: 90 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DNS benchmark
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/dns_benchmark', () => {
  it('returns benchmark results with local and public resolvers', async () => {
    const res = await request(app).get('/api/dns_benchmark');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);
    const local = res.body.results.find((r) => r.isLocal);
    expect(local).toBeDefined();
    expect(local.name).toBe('Local AdGuard Home');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resolver comparison & racing
// ─────────────────────────────────────────────────────────────────────────────
describe('Resolver comparison & race engine', () => {
  it('GET /api/resolvers/compare returns providers, leaderboard, and timeline', async () => {
    mockAghGet({
      top_upstreams_responses: [{ '1.1.1.1:53': 50 }, { '9.9.9.9:53': 70 }],
      top_upstreams_avg_time: [{ '1.1.1.1:53': 0.015 }, { '9.9.9.9:53': 0.012 }],
    });
    const res = await request(app).get('/api/resolvers/compare');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.providers)).toBe(true);
    expect(Array.isArray(res.body.leaderboard)).toBe(true);
    expect(Array.isArray(res.body.timeline)).toBe(true);
    expect(res.body.timeline.length).toBe(24);
  });

  it('POST /api/resolvers/race executes race and updates cache', async () => {
    const res = await request(app).post('/api/resolvers/race');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.race).toHaveProperty('winner');
    expect(Array.isArray(res.body.race.podium)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom filtering rules endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe('Custom rules endpoints', () => {
  it('GET /api/filtering/rules returns list of rules', async () => {
    mockAghGet({ user_rules: ['||ad.com^', '||tracker.org^'] });
    const res = await request(app).get('/api/filtering/rules');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['||ad.com^', '||tracker.org^']);
  });

  it('POST /api/filtering/rules/add adds a new rule', async () => {
    mockAghGet({ user_rules: ['||ad.com^'] });
    mockAghPost({});
    const res = await request(app)
      .post('/api/filtering/rules/add')
      .send({ rule: '||new-tracker.com^' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /api/filtering/rules/remove deletes specified rule', async () => {
    mockAghGet({ user_rules: ['||ad.com^', '||tracker.org^'] });
    mockAghPost({});
    const res = await request(app)
      .post('/api/filtering/rules/remove')
      .send({ rule: '||ad.com^' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional defensive & edge-case tests
// ─────────────────────────────────────────────────────────────────────────────
describe('Client log & safesearch edge cases', () => {
  it('GET /api/client_log/:ip returns client log data', async () => {
    mockAghGet({ data: [], total: 0 });
    const res = await request(app).get('/api/client_log/192.168.1.50');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  it('POST /api/security/safesearch rejects empty body with no settings or enabled', async () => {
    const res = await request(app).post('/api/security/safesearch').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/protection handles raw null JSON payload without crash', async () => {
    const res = await request(app)
      .post('/api/protection')
      .set('Content-Type', 'application/json')
      .send('null');
    expect(res.status).toBe(400);
  });

  it('GET /api/top_clients returns top clients array safely', async () => {
    mockAghGet({ top_clients: [{ '192.168.1.10': 15 }] });
    const res = await request(app).get('/api/top_clients');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ '192.168.1.10': 15 }]);
  });

  it('GET /api/filter_lists returns map with User Rules fallback', async () => {
    mockAghGet({ filters: [{ id: 1, name: 'AdGuard Base' }] });
    const res = await request(app).get('/api/filter_lists');
    expect(res.status).toBe(200);
    expect(res.body[1]).toBe('AdGuard Base');
    expect(res.body[0]).toBe('User Rules');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Server Node Management
// ─────────────────────────────────────────────────────────────────────────────
describe('Multi-server node endpoints', () => {
  it('GET /api/servers returns servers list without exposing raw passwords', async () => {
    const res = await request(app).get('/api/servers');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.servers)).toBe(true);
    expect(res.body.servers.length).toBeGreaterThanOrEqual(1);
    expect(res.body.activeServer).toBeDefined();
    expect(res.body.activeServer.password).toBeUndefined();
    expect(res.body.servers[0].password).toBeUndefined();
    expect(typeof res.body.servers[0].hasPassword).toBe('boolean');
  });

  it('POST /api/servers/test tests connection to a mock server', async () => {
    mockAghGet({ version: 'v0.107.45', running: true, dns_port: 53, http_port: 80 });
    const res = await request(app).post('/api/servers/test').send({
      host: 'http://192.168.1.200:80',
      username: 'admin',
      password: 'password123',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.version).toBe('v0.107.45');
  });

  it('POST /api/servers validates required host', async () => {
    const res = await request(app).post('/api/servers').send({ name: 'Node 2' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('POST /api/servers adds a new server and allows switching', async () => {
    const addRes = await request(app).post('/api/servers').send({
      name: 'Secondary Node',
      host: 'http://192.168.1.199:80',
      username: 'nodeuser',
      password: 'nodepassword',
      autoSwitch: false,
    });
    expect(addRes.status).toBe(200);
    expect(addRes.body.ok).toBe(true);
    expect(addRes.body.server.name).toBe('Secondary Node');
    const newServerId = addRes.body.server.id;

    // Switch to new server
    const switchRes = await request(app).post(`/api/servers/${newServerId}/switch`);
    expect(switchRes.status).toBe(200);
    expect(switchRes.body.ok).toBe(true);
    expect(switchRes.body.activeServer.id).toBe(newServerId);

    // Update server name
    const updateRes = await request(app).put(`/api/servers/${newServerId}`).send({
      name: 'Updated Node Name',
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.server.name).toBe('Updated Node Name');

    // Delete the server
    const deleteRes = await request(app).delete(`/api/servers/${newServerId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Atlas World Map Endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe('Atlas World Map endpoints', () => {
  it('GET /api/atlas/config returns client map configuration', async () => {
    const res = await request(app).get('/api/atlas/config');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('live');
    expect(res.body.home).toBeDefined();
    expect(typeof res.body.home.lat).toBe('number');
    expect(typeof res.body.home.lon).toBe('number');
  });

  it('POST /api/atlas/config/home updates home location coordinates', async () => {
    const res = await request(app).post('/api/atlas/config/home').send({
      lat: 51.5074,
      lon: -0.1278,
      label: 'London Home',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.home.lat).toBe(51.5074);
    expect(res.body.home.lon).toBe(-0.1278);
    expect(res.body.home.label).toBe('London Home');
  });

  it('POST /api/atlas/config/home rejects invalid coordinates', async () => {
    const res = await request(app).post('/api/atlas/config/home').send({
      lat: 95, // out of range
      lon: 50,
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/atlas/snapshot returns current snapshot with events array', async () => {
    mockAghGet({ data: [{ question: { name: 'example.com', type: 'A' }, answer: [{ type: 'A', value: '93.184.216.34' }] }] });
    const res = await request(app).get('/api/atlas/snapshot');
    expect(res.status).toBe(200);
    expect(typeof res.body.now).toBe('number');
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.status.geoip).toBe(true);
  });
});


