#!/usr/bin/env node
/**
 * supplement-overpass.js
 *
 * Queries the Overpass API for lighthouses in India and the Middle East that
 * are missing from the geodienst-sourced dataset, then merges them into
 * data/lighthouses-full.json.
 *
 * The geodienst source only includes lights with seamark:light tags; this
 * script also picks up nodes/ways tagged man_made=lighthouse without seamark
 * data, which is common for Indian DGLL lighthouses.
 *
 * Usage: node scripts/supplement-overpass.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LIGHTHOUSES_FILE = path.join(DATA_DIR, 'lighthouses-full.json');
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Bounding boxes: [south, west, north, east]
const REGIONS = {
  india:       { bbox: [6, 68, 37, 98],  label: 'India' },
  middle_east: { bbox: [12, 25, 42, 63], label: 'Middle East' },
};

// Distance threshold for deduplication (~100m at equator)
const DEDUP_THRESHOLD = 0.001; // degrees

// ─── Helpers (mirrored from process-data.js) ────────────────────────────────

function pf(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function pi(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function normalizeColor(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const part = s.includes(';') ? s.split(';')[0].trim() : s;
  const map = {
    'white': 'white', 'W': 'white', 'w': 'white',
    'red': 'red', 'R': 'red', 'r': 'red',
    'green': 'green', 'G': 'green', 'g': 'green',
    'yellow': 'yellow', 'Y': 'yellow', 'y': 'yellow', 'amber': 'yellow',
    'blue': 'blue', 'B': 'blue', 'b': 'blue',
    'orange': 'orange',
    'violet': 'violet',
  };
  return map[part] || part.toLowerCase();
}

function parseColors(raw) {
  if (!raw) return [];
  return raw.split(';').map(normalizeColor).filter(Boolean);
}

function normalizeCharacter(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const map = {
    'Fl': 'Fl', 'FL': 'Fl', 'flashing': 'Fl',
    'Oc': 'Oc', 'oc': 'Oc',
    'Iso': 'Iso', 'ISO': 'Iso',
    'F': 'F',
    'Q': 'Q',
    'VQ': 'VQ',
    'UQ': 'UQ',
    'IQ': 'IQ',
    'IVQ': 'IVQ',
    'LFl': 'LFl', 'LFI': 'LFl', 'LF': 'LFl',
    'Mo': 'Mo',
    'Al': 'Al',
    'Al.Fl': 'Al.Fl', 'AlFl': 'Al.Fl',
    'Al.Oc': 'Al.Oc',
    'AlQ': 'Al.Q',
    'FFl': 'FFl', 'FLFl': 'FFl',
    'OcFl': 'OcFl',
    'Q+LFl': 'Q+LFl',
    'VQ+LFl': 'VQ+LFl',
  };
  if (map[s]) return map[s];
  const m = s.match(/^([A-Za-z.+]+)/);
  if (m && map[m[1]]) return map[m[1]];
  return s;
}

function extractSectors(tags) {
  const sectors = [];
  for (let i = 1; i <= 30; i++) {
    const prefix = `seamark:light:${i}:`;
    const color = tags[prefix + 'colour'];
    const sectorStart = tags[prefix + 'sector_start'];
    const sectorEnd = tags[prefix + 'sector_end'];

    if (color === undefined && sectorStart === undefined) {
      if (tags[`seamark:light:${i + 1}:colour`] === undefined &&
          tags[`seamark:light:${i + 1}:sector_start`] === undefined) {
        break;
      }
      continue;
    }

    sectors.push({
      index: i,
      color: normalizeColor(color),
      start: pf(sectorStart),
      end: pf(sectorEnd),
      range: pf(tags[prefix + 'range']),
      character: normalizeCharacter(tags[prefix + 'character']),
      period: pf(tags[prefix + 'period']),
      height: pf(tags[prefix + 'height']),
      group: pi(tags[prefix + 'group']),
      sequence: tags[prefix + 'sequence'] || null,
    });
  }
  return sectors;
}

function resolveColors(tags, sectors) {
  const primaryRaw = tags['seamark:light:colour'];
  const primaryColors = parseColors(primaryRaw);
  const sectorColors = sectors.map(s => s.color).filter(Boolean);
  const allColors = [...primaryColors];
  sectorColors.forEach(c => {
    if (!allColors.includes(c)) allColors.push(c);
  });
  return {
    primary: primaryColors[0] || sectorColors[0] || null,
    all: allColors.length > 0 ? allColors : [],
  };
}

function deriveName(tags) {
  return tags['name:en'] || tags['seamark:name'] || tags['name'] || null;
}

/** Strip HTML tags from a string */
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').trim();
}

/** Sanitize all string fields on a lighthouse object */
function sanitizeLighthouse(lh) {
  for (const key of Object.keys(lh)) {
    if (typeof lh[key] === 'string') {
      lh[key] = sanitize(lh[key]);
    }
  }
  if (lh.sectors) {
    lh.sectors.forEach(s => {
      for (const key of Object.keys(s)) {
        if (typeof s[key] === 'string') {
          s[key] = sanitize(s[key]);
        }
      }
    });
  }
  return lh;
}

// ─── Overpass query ─────────────────────────────────────────────────────────

function buildQuery(bbox) {
  const [south, west, north, east] = bbox;
  const bb = `(${south},${west},${north},${east})`;
  return `[out:json][timeout:60];
(
  node["man_made"="lighthouse"]${bb};
  way["man_made"="lighthouse"]${bb};
  node["seamark:type"="light_major"]${bb};
  way["seamark:type"="light_major"]${bb};
  node["seamark:type"="light_minor"]${bb};
  way["seamark:type"="light_minor"]${bb};
  node["seamark:type"="light_vessel"]${bb};
  way["seamark:type"="light_vessel"]${bb};
  node["seamark:light:character"]${bb};
  way["seamark:light:character"]${bb};
);
out center body;`;
}

function fetchOverpass(query) {
  return new Promise((resolve, reject) => {
    const body = `data=${encodeURIComponent(query)}`;
    const url = new URL(OVERPASS_URL);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      let totalSize = 0;

      res.on('data', (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Overpass API returned HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf-8').slice(0, 500)}`));
          return;
        }
        const data = Buffer.concat(chunks).toString('utf-8');
        resolve(data);
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Request timed out after 2 minutes'));
    });

    req.write(body);
    req.end();
  });
}

// ─── Element → Lighthouse ───────────────────────────────────────────────────

function elementToLighthouse(el) {
  const tags = el.tags || {};

  // For ways, use center coordinates
  let lat = el.lat;
  let lon = el.lon;
  if (el.type === 'way' && el.center) {
    lat = el.center.lat;
    lon = el.center.lon;
  }

  if (lat === undefined || lat === null || lon === undefined || lon === null) {
    return null;
  }

  const sectors = extractSectors(tags);
  const { primary: primaryColor, all: allColors } = resolveColors(tags, sectors);

  // Determine if this lighthouse has any seamark light data
  const hasSeamarkLight = !!(
    tags['seamark:light:character'] ||
    tags['seamark:light:colour'] ||
    tags['seamark:light:1:character'] ||
    tags['seamark:light:1:colour']
  );

  const lighthouse = {
    id: String(el.id),
    name: deriveName(tags),
    lat,
    lon,
    character: normalizeCharacter(tags['seamark:light:character']) || (hasSeamarkLight ? null : 'F'),
    color: primaryColor || (hasSeamarkLight ? null : 'white'),
    colors: allColors.length > 0 ? allColors : (hasSeamarkLight ? [] : ['white']),
    period: pf(tags['seamark:light:period']),
    group: pi(tags['seamark:light:group']),
    sequence: tags['seamark:light:sequence'] || null,
    range: pf(tags['seamark:light:range']),
    height: pf(tags['seamark:light:height']),
    sectors: sectors.length > 0 ? sectors : [],
  };

  return sanitizeLighthouse(lighthouse);
}

// ─── Deduplication ──────────────────────────────────────────────────────────

function isDuplicate(newLh, existingList) {
  for (const existing of existingList) {
    if (
      Math.abs(existing.lat - newLh.lat) < DEDUP_THRESHOLD &&
      Math.abs(existing.lon - newLh.lon) < DEDUP_THRESHOLD
    ) {
      return true;
    }
  }
  return false;
}

// ─── Classify region ────────────────────────────────────────────────────────

function classifyRegion(lat, lon) {
  if (lat >= 6 && lat <= 37 && lon >= 68 && lon <= 98) return 'india';
  if (lat >= 12 && lat <= 42 && lon >= 25 && lon <= 63) return 'middle_east';
  return 'other';
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Load existing data
  console.log(`Reading existing lighthouses from ${LIGHTHOUSES_FILE}...`);
  const existing = JSON.parse(fs.readFileSync(LIGHTHOUSES_FILE, 'utf-8'));
  console.log(`Existing lighthouses: ${existing.length}`);

  const stats = { india: 0, middle_east: 0 };
  let totalFetched = 0;
  let totalSkippedNoCoords = 0;
  let totalDuplicates = 0;

  // We will accumulate all new lighthouses here
  const allNew = [];

  for (const [regionKey, region] of Object.entries(REGIONS)) {
    console.log(`\nQuerying Overpass API for ${region.label} (bbox: ${region.bbox.join(', ')})...`);
    const query = buildQuery(region.bbox);

    let responseText;
    try {
      responseText = await fetchOverpass(query);
    } catch (err) {
      console.error(`  ERROR fetching ${region.label}: ${err.message}`);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (err) {
      console.error(`  ERROR parsing response for ${region.label}: ${err.message}`);
      console.error('  First 300 chars:', responseText.slice(0, 300));
      continue;
    }

    const elements = parsed.elements || [];
    console.log(`  Overpass returned ${elements.length} elements for ${region.label}`);
    totalFetched += elements.length;

    let regionNew = 0;
    let regionDups = 0;
    let regionNoCoords = 0;

    for (const el of elements) {
      const lh = elementToLighthouse(el);
      if (!lh) {
        regionNoCoords++;
        continue;
      }

      // Check against existing + already-added new lighthouses
      if (isDuplicate(lh, existing) || isDuplicate(lh, allNew)) {
        regionDups++;
        continue;
      }

      allNew.push(lh);
      regionNew++;

      // Classify for stats
      const cls = classifyRegion(lh.lat, lh.lon);
      if (cls === 'india') stats.india++;
      else if (cls === 'middle_east') stats.middle_east++;
    }

    console.log(`  ${region.label}: ${regionNew} new, ${regionDups} duplicates, ${regionNoCoords} skipped (no coords)`);
    totalSkippedNoCoords += regionNoCoords;
    totalDuplicates += regionDups;
  }

  // Merge
  const merged = [...existing, ...allNew];

  // Write
  console.log(`\nWriting merged data to ${LIGHTHOUSES_FILE}...`);
  const output = JSON.stringify(merged, null, 2);
  fs.writeFileSync(LIGHTHOUSES_FILE, output, 'utf-8');

  // Validate
  try {
    JSON.parse(fs.readFileSync(LIGHTHOUSES_FILE, 'utf-8'));
    console.log('JSON validation: PASSED');
  } catch (e) {
    console.error('JSON validation: FAILED -', e.message);
    process.exit(1);
  }

  // Stats
  console.log('\n══════════════════════════════════');
  console.log('  Supplement Stats');
  console.log('══════════════════════════════════');
  console.log(`Overpass elements fetched:  ${totalFetched}`);
  console.log(`Skipped (no coordinates):  ${totalSkippedNoCoords}`);
  console.log(`Duplicates filtered:       ${totalDuplicates}`);
  console.log(`New lighthouses added:     ${allNew.length}`);
  console.log(`  - India:                 ${stats.india}`);
  console.log(`  - Middle East:           ${stats.middle_east}`);
  console.log(`  - Other (bbox overlap):  ${allNew.length - stats.india - stats.middle_east}`);
  console.log(`Previous total:            ${existing.length}`);
  console.log(`New total:                 ${merged.length}`);
  console.log(`Output size:               ${(Buffer.byteLength(output, 'utf-8') / (1024 * 1024)).toFixed(2)} MB`);
  console.log('══════════════════════════════════');
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
