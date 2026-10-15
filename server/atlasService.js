const { BlockList, isIP } = require('node:net');
const geoip = require('./geoip');

// IPv4 ranges that are not publicly routable (RFC 6890, RFC 1918, loopback, link-local)
const SPECIAL_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const specialV4 = new BlockList();
for (const [net, prefix] of SPECIAL_V4) specialV4.addSubnet(net, prefix, 'ipv4');

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const specialV6 = new BlockList();
specialV6.addSubnet('2001:db8::', 32, 'ipv6');

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

function isPublicAddress(value) {
  if (typeof value !== 'string') return false;
  const family = isIP(value);
  if (family === 4) return !specialV4.check(value, 'ipv4');
  if (family === 6) {
    const mapped = MAPPED_V4.exec(value);
    if (mapped) return isPublicAddress(mapped[1]);
    return globalV6.check(value, 'ipv6') && !specialV6.check(value, 'ipv6');
  }
  return false;
}

function classifyEntry(entry) {
  const reason = entry.reason || '';
  if (reason.startsWith('Filtered') || entry.status === 'Filtered') {
    return { cls: 'blocked' };
  }

  let sawAddress = false;
  for (const record of entry.answer || []) {
    if (record.type !== 'A' && record.type !== 'AAAA') continue;
    if (!record.value || typeof record.value !== 'string') continue;
    sawAddress = true;
    if (isPublicAddress(record.value)) {
      return { cls: 'allowed', address: record.value };
    }
  }

  if (sawAddress || reason.startsWith('Rewrite')) {
    return { cls: 'local' };
  }

  return { cls: 'noanswer' };
}

class AtlasService {
  constructor() {
    this.seq = 0;
    this.maxWindowMs = 15 * 60 * 1000; // 15 minutes window
    this.maxEvents = 10000;
    this.events = [];
    this.seen = new Set();
    this.clients = new Set();
    this.home = {
      lat: Number(process.env.HOME_LAT) || 28.6139,
      lon: Number(process.env.HOME_LON) || 77.2090,
      label: process.env.HOME_LABEL || 'Home',
    };
  }

  setHomeLocation(lat, lon, label) {
    if (typeof lat === 'number' && Number.isFinite(lat)) this.home.lat = lat;
    if (typeof lon === 'number' && Number.isFinite(lon)) this.home.lon = lon;
    if (typeof label === 'string' && label.trim()) this.home.label = label.trim();
  }

  getConfig() {
    return {
      mode: 'live',
      home: this.home,
      windowMinutes: 15,
      version: '1.0.0',
    };
  }

  getSnapshot() {
    this.prune();
    return {
      now: Date.now(),
      events: this.events,
      status: {
        instances: [{ name: 'AdGuard Home', state: 'ok' }],
        geoip: geoip.isAvailable(),
      },
    };
  }

  prune() {
    const cutoff = Date.now() - this.maxWindowMs;
    this.events = this.events.filter((e) => e.t >= cutoff);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  entryKey(entry) {
    return `${entry.time || ''}|${entry.client || ''}|${entry.question?.name || ''}|${entry.question?.type || ''}`;
  }

  remember(key) {
    this.seen.add(key);
    if (this.seen.size > 5000) {
      let drop = 2500;
      for (const k of this.seen) {
        if (drop-- <= 0) break;
        this.seen.delete(k);
      }
    }
  }

  /**
   * Seed historical entries for the cold-start snapshot without broadcasting them as live flight arcs.
   */
  seedEntries(entries, instanceName = 'AdGuard Home') {
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const seeded = [];
    // Process in chronological order (oldest to newest)
    const reversed = entries.slice().reverse();
    for (const entry of reversed) {
      const key = this.entryKey(entry);
      if (this.seen.has(key)) continue;
      this.remember(key);

      const domain = (entry.question?.name || '').replace(/\.$/, '').toLowerCase();
      if (!domain) continue;

      const timeMs = entry.time ? Date.parse(entry.time) || Date.now() : Date.now();
      const client = entry.client_info?.name || entry.client || 'unknown';
      const { cls, address } = classifyEntry(entry);

      const event = {
        id: (this.seq++).toString(36),
        t: timeMs,
        instance: instanceName,
        client,
        domain,
        qtype: entry.question?.type || '',
        cls,
      };

      if (address) {
        const dest = geoip.lookup(address);
        if (dest) event.dest = dest;
      }

      seeded.push(event);
    }

    if (seeded.length > 0) {
      this.events.push(...seeded);
      this.prune();
    }

    return seeded;
  }

  /**
   * Process incoming poll entries, filter to only genuinely new ones, and broadcast live.
   */
  processEntries(entries, instanceName = 'AdGuard Home') {
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const newEvents = [];
    // Process from oldest to newest so sequence and timestamps are in order
    const reversed = entries.slice().reverse();
    for (const entry of reversed) {
      const key = this.entryKey(entry);
      if (this.seen.has(key)) continue;
      this.remember(key);

      const domain = (entry.question?.name || '').replace(/\.$/, '').toLowerCase();
      if (!domain) continue;

      const timeMs = entry.time ? Date.parse(entry.time) || Date.now() : Date.now();
      const client = entry.client_info?.name || entry.client || 'unknown';
      const { cls, address } = classifyEntry(entry);

      const event = {
        id: (this.seq++).toString(36),
        t: timeMs,
        instance: instanceName,
        client,
        domain,
        qtype: entry.question?.type || '',
        cls,
      };

      if (address) {
        const dest = geoip.lookup(address);
        if (dest) event.dest = dest;
      }

      newEvents.push(event);
    }

    if (newEvents.length > 0) {
      this.events.push(...newEvents);
      this.prune();
      this.broadcast(newEvents);
    }

    return newEvents;
  }

  addClient(res) {
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  broadcast(events) {
    if (this.clients.size === 0 || events.length === 0) return;
    const data = `event: events\ndata: ${JSON.stringify(events)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  broadcastStatus(status) {
    if (this.clients.size === 0) return;
    const data = `event: status\ndata: ${JSON.stringify(status)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}

const instance = new AtlasService();

module.exports = instance;
