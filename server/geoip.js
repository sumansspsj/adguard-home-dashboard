const geoip = require('geoip-lite');
const fs = require('node:fs');
const path = require('node:path');

let mmdbReader = null;
let maxmindLib = null;

// Optional: If user provides a local .mmdb database file via GEOIP_DB env var
if (process.env.GEOIP_DB && fs.existsSync(process.env.GEOIP_DB)) {
  try {
    maxmindLib = require('maxmind');
    maxmindLib.open(process.env.GEOIP_DB).then((reader) => {
      mmdbReader = reader;
      console.log(`[GeoIP] Using MaxMind MMDB database: ${process.env.GEOIP_DB}`);
    }).catch((err) => {
      console.warn(`[GeoIP] Could not open ${process.env.GEOIP_DB}, falling back to geoip-lite:`, err.message);
    });
  } catch (err) {
    console.warn(`[GeoIP] maxmind package not installed or failed to load:`, err.message);
  }
}

let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
  // Fallback if Intl.DisplayNames is unavailable
}

function getCountryName(cc) {
  if (!cc) return undefined;
  if (regionNames) {
    try {
      return regionNames.of(cc);
    } catch {
      return cc;
    }
  }
  return cc;
}

/**
 * Resolves an IP address to latitude, longitude, city, country, and ISO country code.
 * @param {string} address Public IPv4 or IPv6 address
 * @returns {{ lat: number, lon: number, city?: string, country?: string, cc?: string } | undefined}
 */
function lookup(address) {
  if (!address || typeof address !== 'string') return undefined;

  // 1. Try MMDB reader if active
  if (mmdbReader) {
    try {
      const record = mmdbReader.get(address);
      if (record && record.location && typeof record.location.latitude === 'number') {
        const country = record.country || record.registered_country;
        return {
          lat: Math.round(record.location.latitude * 100) / 100,
          lon: Math.round(record.location.longitude * 100) / 100,
          city: record.city?.names?.en || undefined,
          country: country?.names?.en || getCountryName(country?.iso_code),
          cc: country?.iso_code || undefined,
        };
      }
    } catch {
      // Fall through to geoip-lite
    }
  }

  // 2. Default built-in geoip-lite lookup
  try {
    const record = geoip.lookup(address);
    if (!record || !record.ll || !Array.isArray(record.ll)) return undefined;
    const [lat, lon] = record.ll;
    if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;

    return {
      lat: Math.round(lat * 100) / 100,
      lon: Math.round(lon * 100) / 100,
      city: record.city || undefined,
      country: getCountryName(record.country),
      cc: record.country || undefined,
    };
  } catch {
    return undefined;
  }
}

module.exports = {
  lookup,
  isAvailable: () => true,
};
