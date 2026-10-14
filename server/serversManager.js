'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const SECRET_KEY = process.env.CLUSTER_SECRET
  ? crypto.createHash('sha256').update(process.env.CLUSTER_SECRET).digest()
  : crypto.createHash('sha256').update('agh-cluster-default-salt-key').digest();

function encryptPassword(plainText) {
  if (!plainText) return '';
  if (typeof plainText !== 'string' || plainText.startsWith('enc:')) return plainText;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', SECRET_KEY, iv);
    let enc = cipher.update(plainText, 'utf8', 'hex');
    enc += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `enc:${iv.toString('hex')}:${authTag}:${enc}`;
  } catch {
    return plainText;
  }
}

function decryptPassword(cipherText) {
  if (!cipherText || typeof cipherText !== 'string' || !cipherText.startsWith('enc:')) return cipherText || '';
  try {
    const [, ivHex, authTagHex, encHex] = cipherText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', SECRET_KEY, iv);
    decipher.setAuthTag(authTag);
    let dec = decipher.update(encHex, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch {
    return cipherText;
  }
}

const SERVERS_FILE = process.env.SERVERS_FILE || path.join(__dirname, 'servers.json');

let serversInMemory = null;

function normalizeHost(rawHost) {
  if (!rawHost || typeof rawHost !== 'string') {
    throw new Error('Host must be a valid URL string');
  }
  let trimmed = rawHost.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  const parsed = new URL(trimmed);
  // Remove trailing slashes and normalize
  return `${parsed.protocol}//${parsed.host}`;
}

function loadServers() {
  if (serversInMemory) {
    return serversInMemory;
  }

  // In test mode without explicit file, keep in-memory from process.env
  if (process.env.NODE_ENV === 'test' && !process.env.SERVERS_FILE) {
    const host = process.env.AGH_HOST ? normalizeHost(process.env.AGH_HOST) : 'http://127.0.0.1:80';
    const username = process.env.AGH_USERNAME || 'admin';
    const password = process.env.AGH_PASSWORD || '';
    serversInMemory = [
      {
        id: 'srv_primary',
        name: 'Primary Node',
        host,
        username,
        password,
        active: true,
        createdAt: Date.now(),
      },
    ];
    return serversInMemory;
  }

  // Attempt to load from servers.json
  if (fs.existsSync(SERVERS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        serversInMemory = data.map((s) => ({
          ...s,
          password: decryptPassword(s.password),
        }));
        ensureOneActive();
        return serversInMemory;
      }
    } catch (err) {
      console.warn(`[serversManager] Failed to read ${SERVERS_FILE}, falling back to env:`, err.message);
    }
  }

  // Seed initial server from environment or defaults
  const host = process.env.AGH_HOST ? normalizeHost(process.env.AGH_HOST) : 'http://127.0.0.1:80';
  const username = process.env.AGH_USERNAME || 'admin';
  const password = process.env.AGH_PASSWORD || '';

  serversInMemory = [
    {
      id: 'srv_primary',
      name: 'Primary Node',
      host,
      username,
      password,
      active: true,
      createdAt: Date.now(),
    },
  ];

  saveServers();
  return serversInMemory;
}

function ensureOneActive() {
  if (!serversInMemory || serversInMemory.length === 0) return;
  const activeCount = serversInMemory.filter((s) => s.active).length;
  if (activeCount === 1) return;

  if (activeCount === 0) {
    serversInMemory[0].active = true;
  } else {
    // Multiple active — keep only the first active one
    let seenFirst = false;
    for (const s of serversInMemory) {
      if (s.active) {
        if (!seenFirst) {
          seenFirst = true;
        } else {
          s.active = false;
        }
      }
    }
  }
}

function saveServers() {
  if (!serversInMemory) return;
  if (process.env.NODE_ENV === 'test' && !process.env.SERVERS_FILE) {
    return;
  }
  try {
    const serialized = serversInMemory.map((s) => ({
      ...s,
      password: encryptPassword(s.password),
    }));
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(serialized, null, 2), 'utf8');
  } catch (err) {
    console.error(`[serversManager] Failed to write ${SERVERS_FILE}:`, err.message);
  }
}

function sanitizeServer(s) {
  return {
    id: s.id,
    name: s.name || 'AdGuard Home',
    host: s.host,
    username: s.username || '',
    hasPassword: Boolean(s.password),
    active: Boolean(s.active),
    createdAt: s.createdAt || Date.now(),
  };
}

function getPublicServers() {
  loadServers();
  return serversInMemory.map(sanitizeServer);
}

function getActiveServer() {
  loadServers();
  const found = serversInMemory.find((s) => s.active);
  if (found) return found;
  if (serversInMemory[0]) {
    serversInMemory[0].active = true;
    saveServers();
    return serversInMemory[0];
  }
  throw new Error('No AdGuard Home servers configured.');
}

function setActiveServer(id) {
  loadServers();
  const target = serversInMemory.find((s) => s.id === id);
  if (!target) {
    throw new Error(`Server with id "${id}" not found.`);
  }

  for (const s of serversInMemory) {
    s.active = s.id === id;
  }
  saveServers();
  return sanitizeServer(target);
}

function addServer({ name, host, username, password, active }) {
  loadServers();

  if (!name || typeof name !== 'string' || !name.trim()) {
    name = `Node ${serversInMemory.length + 1}`;
  }

  const normalizedHost = normalizeHost(host);
  const newId = `srv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const newServer = {
    id: newId,
    name: name.trim(),
    host: normalizedHost,
    username: (username || '').trim(),
    password: password || '',
    active: Boolean(active) || serversInMemory.length === 0,
    createdAt: Date.now(),
  };

  if (newServer.active) {
    for (const s of serversInMemory) {
      s.active = false;
    }
  }

  serversInMemory.push(newServer);
  ensureOneActive();
  saveServers();

  return sanitizeServer(newServer);
}

function updateServer(id, updates = {}) {
  loadServers();
  const target = serversInMemory.find((s) => s.id === id);
  if (!target) {
    throw new Error(`Server with id "${id}" not found.`);
  }

  if (typeof updates.name === 'string' && updates.name.trim()) {
    target.name = updates.name.trim();
  }
  if (updates.host) {
    target.host = normalizeHost(updates.host);
  }
  if (typeof updates.username === 'string') {
    target.username = updates.username.trim();
  }
  // Only update password if an explicit non-empty string is given
  if (typeof updates.password === 'string' && updates.password.length > 0) {
    target.password = updates.password;
  }

  saveServers();
  return sanitizeServer(target);
}

function deleteServer(id) {
  loadServers();
  if (serversInMemory.length <= 1) {
    throw new Error('Cannot delete the only configured AdGuard Home server.');
  }

  const index = serversInMemory.findIndex((s) => s.id === id);
  if (index === -1) {
    throw new Error(`Server with id "${id}" not found.`);
  }

  const wasActive = serversInMemory[index].active;
  serversInMemory.splice(index, 1);

  if (wasActive) {
    serversInMemory[0].active = true;
  }

  saveServers();
  return {
    ok: true,
    deletedId: id,
    activeId: getActiveServer().id,
  };
}

async function testConnection({ host, username, password }) {
  const normalizedHost = normalizeHost(host);
  const auth = {
    Authorization: `Basic ${Buffer.from(`${username || ''}:${password || ''}`).toString('base64')}`,
  };

  const start = Date.now();
  try {
    const res = await axios.get(`${normalizedHost}/control/status`, {
      headers: auth,
      timeout: 5000,
    });
    const latencyMs = Date.now() - start;

    return {
      ok: true,
      latencyMs,
      data: {
        version: res.data?.version || 'Unknown',
        running: res.data?.running ?? true,
        dns_port: res.data?.dns_port || 53,
        http_port: res.data?.http_port || 80,
        protection_enabled: res.data?.protection_enabled ?? true,
      },
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    let message = err.message;
    let statusCode = err.response?.status;

    if (statusCode === 401 || statusCode === 403) {
      message = 'Authentication failed. Check username and password.';
    } else if (err.code === 'ECONNREFUSED') {
      message = `Connection refused at ${normalizedHost}. Ensure AdGuard Home is running.`;
    } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
      message = `Connection timed out after 5000ms. Check host address and network.`;
    }

    return {
      ok: false,
      latencyMs,
      statusCode: statusCode || 502,
      error: message,
    };
  }
}

// For unit testing: reset state
function _resetForTest(mockList) {
  serversInMemory = mockList ? JSON.parse(JSON.stringify(mockList)) : null;
}

module.exports = {
  loadServers,
  getPublicServers,
  getActiveServer,
  setActiveServer,
  addServer,
  updateServer,
  deleteServer,
  testConnection,
  normalizeHost,
  _resetForTest,
};
