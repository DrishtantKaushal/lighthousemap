#!/usr/bin/env node
/**
 * process-data.js
 *
 * Reads raw geodienst OSM lighthouse data and produces a clean lighthouses.json
 * with parsed light characteristics, colors, sectors, and sequences.
 *
 * Usage: node scripts/process-data.js [--full]
 *   --full  Process data-full.json (26k lights) instead of data.json (1k lighthouses)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const useFull = process.argv.includes('--full');
const inputFile = useFull
  ? path.join(DATA_DIR, 'raw-geodienst-full.json')
  : path.join(DATA_DIR, 'raw-geodienst.json');
const outputFile = useFull
  ? path.join(DATA_DIR, 'lighthouses-full.json')
  : path.join(DATA_DIR, 'lighthouses.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Safely parse a float, returning null on failure */
function pf(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/** Safely parse an int, returning null on failure */
function pi(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

/** Normalize a single color string (no semicolons) */
function normalizeColor(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // If this still has a semicolon, take the first part only
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

/** Parse semicolon-separated color string into array of normalized colors */
function parseColors(raw) {
  if (!raw) return [];
  return raw.split(';').map(normalizeColor).filter(Boolean);
}

/** Normalize light character codes */
function normalizeCharacter(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // Common normalizations
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
  // Try exact match first
  if (map[s]) return map[s];
  // Try stripping parenthetical group like "Fl(1)" → "Fl"
  const m = s.match(/^([A-Za-z.+]+)/);
  if (m && map[m[1]]) return map[m[1]];
  return s;
}

/**
 * Extract sectors from numbered light tags.
 * Tags like seamark:light:1:colour, seamark:light:1:sector_start, etc.
 */
function extractSectors(tags) {
  const sectors = [];
  for (let i = 1; i <= 30; i++) {
    const prefix = `seamark:light:${i}:`;
    const color = tags[prefix + 'colour'];
    const sectorStart = tags[prefix + 'sector_start'];
    const sectorEnd = tags[prefix + 'sector_end'];

    if (color === undefined && sectorStart === undefined) {
      // No more numbered lights — but check one more in case of gaps
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

/**
 * Determine the primary color and all colors for a light.
 * If there are sectors, aggregate unique colors from sectors.
 * Otherwise, use the single seamark:light:colour tag.
 */
function resolveColors(tags, sectors) {
  // Primary color from the non-numbered tag
  const primaryRaw = tags['seamark:light:colour'];
  const primaryColors = parseColors(primaryRaw);

  // Sector colors
  const sectorColors = sectors
    .map(s => s.color)
    .filter(Boolean);

  // Build unique color list, primary first
  const allColors = [...primaryColors];
  sectorColors.forEach(c => {
    if (!allColors.includes(c)) allColors.push(c);
  });

  return {
    primary: primaryColors[0] || sectorColors[0] || null,
    all: allColors.length > 0 ? allColors : (primaryColors.length > 0 ? primaryColors : []),
  };
}

/** Derive a name from tags, preferring English/international names */
function deriveName(tags) {
  return tags['name:en'] || tags['seamark:name'] || tags['name'] || null;
}

// ─── Main processing ────────────────────────────────────────────────────────

console.log(`Reading ${inputFile}...`);
const raw = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
const elements = raw.elements;
console.log(`Total elements: ${elements.length}`);

// Security: check for actual script injection patterns
// (not URL params like collectionId= which are harmless OSM data)
const rawStr = fs.readFileSync(inputFile, 'utf-8');
const suspiciousPatterns = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
];
const found = suspiciousPatterns.filter(p => p.test(rawStr));
if (found.length > 0) {
  console.error('WARNING: Suspicious content detected in raw data:');
  found.forEach(p => console.error('  Matched:', p.toString()));
  console.error('Aborting.');
  process.exit(1);
}
console.log('Security check passed: no script injection detected.');

const lighthouses = [];
let skippedNoCoords = 0;
let skippedNoLight = 0;

for (const el of elements) {
  const tags = el.tags || {};

  // Skip ways without coordinates (they don't have lat/lon in this export)
  if (el.type === 'way' && (el.lat === undefined || el.lat === null)) {
    skippedNoCoords++;
    continue;
  }

  // Must have at least one light-related tag
  const hasLight = tags['seamark:light:character'] ||
                   tags['seamark:light:colour'] ||
                   tags['seamark:light:1:character'] ||
                   tags['seamark:light:1:colour'] ||
                   tags['man_made'] === 'lighthouse';

  if (!hasLight) {
    skippedNoLight++;
    continue;
  }

  const sectors = extractSectors(tags);
  const { primary: primaryColor, all: allColors } = resolveColors(tags, sectors);

  const lighthouse = {
    id: String(el.id),
    name: deriveName(tags),
    lat: el.lat,
    lon: el.lon,
    character: normalizeCharacter(tags['seamark:light:character']),
    color: primaryColor,
    colors: allColors,
    period: pf(tags['seamark:light:period']),
    group: pi(tags['seamark:light:group']),
    sequence: tags['seamark:light:sequence'] || null,
    range: pf(tags['seamark:light:range']),
    height: pf(tags['seamark:light:height']),
    sectors: sectors.length > 0 ? sectors : [],
  };

  // Sanitize all string fields — strip any HTML/script content
  for (const key of Object.keys(lighthouse)) {
    if (typeof lighthouse[key] === 'string') {
      lighthouse[key] = lighthouse[key].replace(/<[^>]*>/g, '').trim();
    }
  }
  // Sanitize sector string fields
  lighthouse.sectors.forEach(s => {
    for (const key of Object.keys(s)) {
      if (typeof s[key] === 'string') {
        s[key] = s[key].replace(/<[^>]*>/g, '').trim();
      }
    }
  });

  lighthouses.push(lighthouse);
}

// ─── Stats ──────────────────────────────────────────────────────────────────

console.log('\n═══ Processing Stats ═══');
console.log(`Input elements:       ${elements.length}`);
console.log(`Skipped (no coords):  ${skippedNoCoords}`);
console.log(`Skipped (no light):   ${skippedNoLight}`);
console.log(`Output lighthouses:   ${lighthouses.length}`);
console.log('');

const withName = lighthouses.filter(l => l.name).length;
const withChar = lighthouses.filter(l => l.character).length;
const withColor = lighthouses.filter(l => l.color).length;
const withPeriod = lighthouses.filter(l => l.period !== null).length;
const withRange = lighthouses.filter(l => l.range !== null).length;
const withHeight = lighthouses.filter(l => l.height !== null).length;
const withGroup = lighthouses.filter(l => l.group !== null).length;
const withSequence = lighthouses.filter(l => l.sequence).length;
const withSectors = lighthouses.filter(l => l.sectors.length > 0).length;

console.log(`With name:            ${withName} (${(100 * withName / lighthouses.length).toFixed(1)}%)`);
console.log(`With character:       ${withChar} (${(100 * withChar / lighthouses.length).toFixed(1)}%)`);
console.log(`With color:           ${withColor} (${(100 * withColor / lighthouses.length).toFixed(1)}%)`);
console.log(`With period:          ${withPeriod} (${(100 * withPeriod / lighthouses.length).toFixed(1)}%)`);
console.log(`With range:           ${withRange} (${(100 * withRange / lighthouses.length).toFixed(1)}%)`);
console.log(`With height:          ${withHeight} (${(100 * withHeight / lighthouses.length).toFixed(1)}%)`);
console.log(`With group:           ${withGroup} (${(100 * withGroup / lighthouses.length).toFixed(1)}%)`);
console.log(`With sequence:        ${withSequence} (${(100 * withSequence / lighthouses.length).toFixed(1)}%)`);
console.log(`With sectors:         ${withSectors} (${(100 * withSectors / lighthouses.length).toFixed(1)}%)`);

// Color distribution
const colorCounts = {};
lighthouses.forEach(l => {
  l.colors.forEach(c => { colorCounts[c] = (colorCounts[c] || 0) + 1; });
});
console.log('\nColor distribution:');
Object.entries(colorCounts).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
  console.log(`  ${c}: ${n}`);
});

// Character distribution
const charCounts = {};
lighthouses.forEach(l => {
  if (l.character) charCounts[l.character] = (charCounts[l.character] || 0) + 1;
});
console.log('\nCharacter distribution:');
Object.entries(charCounts).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
  console.log(`  ${c}: ${n}`);
});

// ─── Write output ───────────────────────────────────────────────────────────

const output = JSON.stringify(lighthouses, null, 2);
fs.writeFileSync(outputFile, output, 'utf-8');

const sizeMB = (Buffer.byteLength(output, 'utf-8') / (1024 * 1024)).toFixed(2);
console.log(`\nOutput written to: ${outputFile}`);
console.log(`Output size: ${sizeMB} MB`);

// Validate the output is valid JSON
try {
  JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
  console.log('JSON validation: PASSED');
} catch (e) {
  console.error('JSON validation: FAILED -', e.message);
  process.exit(1);
}

// File size sanity check: raw file shouldn't be more than 100MB
const statInfo = fs.statSync(outputFile);
if (statInfo.size > 100 * 1024 * 1024) {
  console.error('WARNING: Output file suspiciously large (>100MB)');
  process.exit(1);
}
console.log('File size check: PASSED');

console.log('\nDone.');
