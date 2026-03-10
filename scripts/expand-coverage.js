#!/usr/bin/env node
/**
 * expand-coverage.js
 *
 * Closes the gap between our dataset (20,205) and lighthouse-atlas (23,217)
 * by querying Overpass API globally and applying curated quality filters.
 *
 * The lighthouse-atlas (geodienst) primarily queries for lights with
 * seamark:light:sequence tags (~18k). Our dataset already has those.
 * The remaining ~5k gap comes from:
 *   - Lights with sector sequences (seamark:light:1:sequence)
 *   - Lighthouses tagged man_made=lighthouse with names
 *   - Lights with character+colour+period or character+colour+range
 *
 * Quality tiers (applied during merge):
 *   Tier 1: Has sequence data (primary or sector) -> always keep
 *   Tier 2: Has character + colour + (period OR range) -> keep
 *   Tier 3: man_made=lighthouse with name -> keep
 *   Tier 4: Has character + colour only -> keep if ALSO has name OR height
 *   Skip: unnamed minor marks with only character+colour -> too many, skip
 *
 * Usage: node scripts/expand-coverage.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LIGHTHOUSES_FILE = path.join(DATA_DIR, 'lighthouses-full.json');
const BACKUP_FILE = path.join(DATA_DIR, 'lighthouses-full.backup.json');

const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const DEDUP_THRESHOLD = 0.001;

// We run 3 focused queries
const QUERIES = [
  {
    name: 'Lights with sequence (global)',
    query: `[out:json][timeout:300];(node["seamark:light:sequence"];node["seamark:light:1:sequence"];);out body;`,
    tier: 1,
  },
  {
    name: 'Sectored lights (1:character, no main seq)',
    query: `[out:json][timeout:300];node["seamark:light:1:character"][!"seamark:light:character"][!"seamark:light:sequence"][!"seamark:light:1:sequence"];out body;`,
    tier: 2,
  },
  {
    name: 'Lighthouses (man_made, global)',
    query: `[out:json][timeout:300];(node["man_made"="lighthouse"];way["man_made"="lighthouse"];);out center body;`,
    tier: 3,
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function pf(v) { if (v == null || v === '') return null; const n = parseFloat(v); return isNaN(n) ? null : n; }
function pi(v) { if (v == null || v === '') return null; const n = parseInt(v, 10); return isNaN(n) ? null : n; }

function normalizeColor(raw) {
  if (!raw) return null;
  const part = (raw.includes(';') ? raw.split(';')[0] : raw).trim();
  const map = {'white':'white','W':'white','w':'white','red':'red','R':'red','r':'red','green':'green','G':'green','g':'green','yellow':'yellow','Y':'yellow','y':'yellow','amber':'yellow','blue':'blue','B':'blue','b':'blue','orange':'orange','violet':'violet'};
  return map[part] || part.toLowerCase();
}
function parseColors(raw) { return raw ? raw.split(';').map(normalizeColor).filter(Boolean) : []; }

function normalizeCharacter(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const map = {'Fl':'Fl','FL':'Fl','flashing':'Fl','Oc':'Oc','oc':'Oc','Iso':'Iso','ISO':'Iso','F':'F','Q':'Q','VQ':'VQ','UQ':'UQ','IQ':'IQ','IVQ':'IVQ','LFl':'LFl','LFI':'LFl','LF':'LFl','Mo':'Mo','Al':'Al','Al.Fl':'Al.Fl','AlFl':'Al.Fl','Al.Oc':'Al.Oc','AlQ':'Al.Q','FFl':'FFl','FLFl':'FFl','OcFl':'OcFl','Q+LFl':'Q+LFl','VQ+LFl':'VQ+LFl'};
  if (map[s]) return map[s];
  const m = s.match(/^([A-Za-z.+]+)/);
  if (m && map[m[1]]) return map[m[1]];
  return s;
}

function extractSectors(tags) {
  const sectors = [];
  for (let i = 1; i <= 30; i++) {
    const p = `seamark:light:${i}:`;
    const color = tags[p+'colour'], start = tags[p+'sector_start'];
    if (color === undefined && start === undefined) {
      if (tags[`seamark:light:${i+1}:colour`] === undefined && tags[`seamark:light:${i+1}:sector_start`] === undefined) break;
      continue;
    }
    sectors.push({ index:i, color:normalizeColor(color), start:pf(start), end:pf(tags[p+'sector_end']), range:pf(tags[p+'range']), character:normalizeCharacter(tags[p+'character']), period:pf(tags[p+'period']), height:pf(tags[p+'height']), group:pi(tags[p+'group']), sequence:tags[p+'sequence']||null });
  }
  return sectors;
}

function sanitize(s) { return typeof s === 'string' ? s.replace(/<[^>]*>/g, '').trim() : s; }

function elementToLighthouse(el) {
  const tags = el.tags || {};
  if (Object.keys(tags).length === 0) return null;
  let lat = el.lat, lon = el.lon;
  if (el.type === 'way' && el.center) { lat = el.center.lat; lon = el.center.lon; }
  if (lat == null || lon == null) return null;

  const hasSeamark = !!(tags['seamark:light:character']||tags['seamark:light:colour']||tags['seamark:light:1:character']||tags['seamark:light:1:colour']||tags['seamark:light:sequence']||tags['seamark:light:1:sequence']);
  const isLH = tags['man_made'] === 'lighthouse';
  if (!hasSeamark && !isLH) return null;

  const sectors = extractSectors(tags);
  const primaryColors = parseColors(tags['seamark:light:colour']);
  const sectorColors = sectors.map(s=>s.color).filter(Boolean);
  const allColors = [...primaryColors]; sectorColors.forEach(c=>{if(!allColors.includes(c))allColors.push(c);});

  const lh = {
    id: String(el.id),
    name: sanitize(tags['name:en']||tags['seamark:name']||tags['name']||null),
    lat, lon,
    character: normalizeCharacter(tags['seamark:light:character']) || (hasSeamark ? null : 'F'),
    color: primaryColors[0]||sectorColors[0]||(hasSeamark?null:'white'),
    colors: allColors.length > 0 ? allColors : (hasSeamark?[]:['white']),
    period: pf(tags['seamark:light:period']),
    group: pi(tags['seamark:light:group']),
    sequence: tags['seamark:light:sequence']||null,
    range: pf(tags['seamark:light:range']),
    height: pf(tags['seamark:light:height']),
    sectors,
  };
  lh.sectors.forEach(s=>{for(const k of Object.keys(s))if(typeof s[k]==='string')s[k]=sanitize(s[k]);});
  return lh;
}

/** Check quality tier for a new light */
function passesQuality(lh, tier) {
  // Tier 1: sequence query — always keep
  if (tier === 1) return true;

  // Tier 2: sectored lights / lights with range — keep if has real data
  if (tier === 2) {
    if (lh.sectors.length > 0) return true;
    if (lh.range != null) return true;
    if (lh.period != null && lh.character) return true;
    return false;
  }

  // Tier 3: man_made=lighthouse — keep if named
  if (tier === 3) {
    // Must have a name to be considered a real lighthouse (vs unnamed ruin/structure)
    if (!lh.name) return false;
    return true;
  }

  return false;
}

// ─── Spatial index ──────────────────────────────────────────────────────────

class SpatialIndex {
  constructor(t) { this.t=t; this.cs=t*2; this.g=new Map(); this.ids=new Set(); }
  _k(a,o){return `${Math.floor(a/this.cs)},${Math.floor(o/this.cs)}`;}
  add(l){this.ids.add(l.id);const k=this._k(l.lat,l.lon);if(!this.g.has(k))this.g.set(k,[]);this.g.get(k).push(l);}
  addAll(ls){for(const l of ls)this.add(l);}
  isDup(l){
    if(this.ids.has(l.id))return true;
    const lc=Math.floor(l.lat/this.cs),nc=Math.floor(l.lon/this.cs);
    for(let d=-1;d<=1;d++)for(let n=-1;n<=1;n++){const c=this.g.get(`${lc+d},${nc+n}`);if(!c)continue;for(const e of c)if(Math.abs(e.lat-l.lat)<this.t&&Math.abs(e.lon-l.lon)<this.t)return true;}
    return false;
  }
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function fetchOverpass(query,ep){
  return new Promise((resolve,reject)=>{
    const body=`data=${encodeURIComponent(query)}`;
    const url=new URL(ep);
    const req=https.request({hostname:url.hostname,port:443,path:url.pathname,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},(res)=>{
      const ch=[];res.on('data',c=>ch.push(c));
      res.on('end',()=>{if(res.statusCode!==200){reject(new Error(`HTTP ${res.statusCode}`));return;}resolve(Buffer.concat(ch).toString('utf-8'));});
      res.on('error',reject);
    });
    req.on('error',reject);
    req.setTimeout(420000,()=>{req.destroy();reject(new Error('Timeout'));});
    req.write(body);req.end();
  });
}

async function fetchWithFailover(query){
  for(let i=0;i<OVERPASS_ENDPOINTS.length;i++){
    const ep=OVERPASS_ENDPOINTS[i];
    process.stdout.write(`  ${new URL(ep).hostname}... `);
    try{const r=await fetchOverpass(query,ep);console.log('OK');return r;}
    catch(e){console.log(e.message);if(i<OVERPASS_ENDPOINTS.length-1)await sleep(5000);}
  }
  return null;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(){
  console.log('============================================================');
  console.log('  Lighthouse Coverage Expansion');
  console.log('============================================================\n');

  console.log(`Reading ${LIGHTHOUSES_FILE}...`);
  const existing=JSON.parse(fs.readFileSync(LIGHTHOUSES_FILE,'utf-8'));
  const origCount=existing.length;
  console.log(`Existing: ${origCount}\n`);

  fs.copyFileSync(LIGHTHOUSES_FILE,BACKUP_FILE);
  console.log(`Backup: ${BACKUP_FILE}\n`);

  const index=new SpatialIndex(DEDUP_THRESHOLD);
  index.addAll(existing);

  const stats=[];
  let grandNew=0;

  for(let qi=0;qi<QUERIES.length;qi++){
    const q=QUERIES[qi];
    console.log(`[${qi+1}/${QUERIES.length}] ${q.name}`);

    const resp=await fetchWithFailover(q.query);
    if(!resp){console.log('  SKIPPED\n');stats.push({name:q.name,fetched:0,new:0,error:true});if(qi<QUERIES.length-1)await sleep(10000);continue;}

    let parsed;
    try{parsed=JSON.parse(resp);}catch(e){console.log(`  Parse error\n`);stats.push({name:q.name,fetched:0,new:0,error:true});if(qi<QUERIES.length-1)await sleep(10000);continue;}

    const els=parsed.elements||[];
    let qNew=0,qDup=0,qSkip=0,qFilt=0;

    for(const el of els){
      const lh=elementToLighthouse(el);
      if(!lh){qSkip++;continue;}
      if(index.isDup(lh)){qDup++;continue;}
      if(!passesQuality(lh,q.tier)){qFilt++;continue;}
      index.add(lh);existing.push(lh);qNew++;
    }

    console.log(`  ${els.length} elements -> +${qNew} new (${qDup} dups, ${qFilt} filtered)\n`);
    grandNew+=qNew;
    stats.push({name:q.name,fetched:els.length,new:qNew,filtered:qFilt,error:false});

    if(qi<QUERIES.length-1){console.log('  Waiting 10s...');await sleep(10000);}
  }

  // Write
  console.log(`Writing ${existing.length} lighthouses...`);
  const output=JSON.stringify(existing,null,2);
  fs.writeFileSync(LIGHTHOUSES_FILE,output,'utf-8');
  try{JSON.parse(fs.readFileSync(LIGHTHOUSES_FILE,'utf-8'));console.log('JSON: OK');}
  catch(e){console.error('JSON: FAILED');fs.copyFileSync(BACKUP_FILE,LIGHTHOUSES_FILE);process.exit(1);}

  // Report
  console.log('\n============================================================');
  console.log('  RESULTS');
  console.log('============================================================\n');

  for(const s of stats){
    if(s.error)console.log(`  ${s.name}: ERROR`);
    else console.log(`  ${s.name}: ${s.fetched} fetched, +${s.new} new, ${s.filtered||0} filtered`);
  }

  console.log(`\n  Original:     ${origCount}`);
  console.log(`  Added:        ${grandNew}`);
  console.log(`  NEW TOTAL:    ${existing.length}`);
  console.log(`  Target:       ~23,217 (lighthouse-atlas)`);
  console.log(`  Size:         ${(Buffer.byteLength(output)/(1024*1024)).toFixed(2)} MB\n`);

  // Geographic comparison
  console.log('Geographic distribution (before -> after):');
  const regions={
    'North Europe':[45,72,-30,40],'South Europe/Med':[30,45,-15,40],
    'North America':[24,72,-170,-50],'Central Am/Carib':[5,24,-120,-60],
    'South America':[-60,5,-90,-30],'Africa':[-40,37,-25,55],
    'Middle East':[12,42,25,63],'South/SE Asia':[-11,37,63,141],
    'East Asia':[18,55,100,150],'Oceania':[-50,0,100,180],
    'Russia/Arctic':[55,78,30,180],
  };
  const backup=JSON.parse(fs.readFileSync(BACKUP_FILE,'utf-8'));
  for(const[name,bb]of Object.entries(regions)){
    const before=backup.filter(l=>l.lat>=bb[0]&&l.lat<=bb[1]&&l.lon>=bb[2]&&l.lon<=bb[3]).length;
    const after=existing.filter(l=>l.lat>=bb[0]&&l.lat<=bb[1]&&l.lon>=bb[2]&&l.lon<=bb[3]).length;
    console.log(`  ${name.padEnd(20)} ${String(before).padStart(6)} -> ${String(after).padStart(6)}  (+${after-before})`);
  }

  console.log(`\nBackup: ${BACKUP_FILE}`);
  console.log('Done.');
}

main().catch(err=>{console.error('Fatal:',err);process.exit(1);});
