#!/usr/bin/env node
/**
 * fetch-overpass.js
 *
 * Fallback data fetcher that queries the Overpass API directly for lighthouse
 * and light data from OpenStreetMap. Use this if the pre-processed geodienst
 * data at https://github.com/geodienst/lighthousemap is unavailable.
 *
 * Usage: node scripts/fetch-overpass.js [--full]
 *   --full  Also fetch light_minor nodes (much larger dataset, ~25k+)
 *   (default) Only fetch light_major + man_made=lighthouse (~2k nodes)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');
const useFull = process.argv.includes('--full');

// Overpass QL query
const query = useFull
  ? `[out:json][timeout:300];
(
  node["seamark:type"="light_major"];
  node["seamark:type"="light_minor"];
  node["man_made"="lighthouse"];
);
out body;`
  : `[out:json][timeout:300];
(
  node["seamark:type"="light_major"];
  node["man_made"="lighthouse"];
);
out body;`;

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

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

    console.log(`Querying Overpass API (${useFull ? 'full' : 'major lights only'})...`);
    console.log('This may take 1-5 minutes depending on server load.');

    const req = https.request(options, (res) => {
      const chunks = [];
      let totalSize = 0;

      res.on('data', (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
        // Progress indicator every 1MB
        if (totalSize % (1024 * 1024) < chunk.length) {
          console.log(`  Received ${(totalSize / (1024 * 1024)).toFixed(1)} MB...`);
        }
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Overpass API returned HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf-8').slice(0, 500)}`));
          return;
        }
        const data = Buffer.concat(chunks).toString('utf-8');
        console.log(`  Total received: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);
        resolve(data);
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(360000, () => {
      req.destroy();
      reject(new Error('Request timed out after 6 minutes'));
    });

    req.write(body);
    req.end();
  });
}

async function main() {
  try {
    const data = await fetchOverpass(query);

    // Validate JSON
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse Overpass response as JSON:', e.message);
      console.error('First 500 chars:', data.slice(0, 500));
      process.exit(1);
    }

    const outputName = useFull ? 'raw-overpass-full.json' : 'raw-overpass.json';
    const outputPath = path.join(DATA_DIR, outputName);

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(parsed, null, 2), 'utf-8');

    console.log(`\nSaved to: ${outputPath}`);
    console.log(`Elements: ${parsed.elements ? parsed.elements.length : 'unknown'}`);
    console.log(`File size: ${(fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2)} MB`);

    console.log('\nTo process this data, run:');
    console.log('  node scripts/process-data.js');
    console.log('(The process-data.js script works with both geodienst and Overpass output formats since they share the same OSM JSON structure.)');
  } catch (err) {
    console.error('Error fetching from Overpass API:', err.message);
    console.error('\nTroubleshooting:');
    console.error('  - The Overpass API may be rate-limited. Wait a few minutes and try again.');
    console.error('  - Try a different Overpass endpoint: https://overpass.kumi.systems/api/interpreter');
    console.error('  - Check https://overpass-api.de/api/status for server load.');
    process.exit(1);
  }
}

main();
