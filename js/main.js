/**
 * main.js
 * -------
 * Core application: initializes the MapLibre map, loads lighthouse data,
 * drives the canvas animation loop, and wires up interaction handlers.
 */

(() => {
  'use strict';

  // ---- DOM refs ----
  const mapContainer = document.getElementById('map');
  const canvas = document.getElementById('light-canvas');
  const ctx = canvas.getContext('2d');
  const loadingOverlay = document.getElementById('loading-overlay');
  const lightCountEl = document.getElementById('light-count');
  const visibleCountEl = document.getElementById('visible-count');
  const zoomLevelEl = document.getElementById('zoom-level');

  // ---- State ----
  let lighthouses = [];        // full dataset
  let parsedPatterns = [];     // pre-parsed LightPatterns descriptors (parallel array)
  let map = null;
  let animFrameId = null;
  let hoveredIndex = -1;       // index into lighthouses[] of currently hovered light
  const HOVER_RADIUS_PX = 14;  // pixel radius for hover detection

  // ---- Initialize map ----
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [0, 30],
    zoom: 3,
    minZoom: 1,
    maxZoom: 18,
    attributionControl: false,
    scrollZoom: true,
    boxZoom: true,
    dragRotate: true,
    dragPan: true,
    keyboard: true,
    doubleClickZoom: true,
    touchZoomRotate: true,
    touchPitch: true,
  });

  // Navigation controls (zoom +/- buttons) as fallback for trackpad issues
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  // ---- Canvas sizing ----
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = mapContainer.clientWidth * dpr;
    canvas.height = mapContainer.clientHeight * dpr;
    canvas.style.width = mapContainer.clientWidth + 'px';
    canvas.style.height = mapContainer.clientHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // ---- Force English labels on all map layers ----
  map.on('styledata', () => {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    style.layers.forEach(layer => {
      if (layer.layout && layer.layout['text-field']) {
        map.setLayoutProperty(layer.id, 'text-field', [
          'coalesce',
          ['get', 'name:en'],
          ['get', 'name_en'],
          ['get', 'name']
        ]);
      }
    });
  });

  // ---- Load data ----
  map.on('load', async () => {
    try {
      // Use full dataset (~17k lights) by default; ?lite for smaller set
      const useFull = !window.location.search.includes('lite');
      const dataUrl = useFull ? 'data/lighthouses-full.json' : 'data/lighthouses.json';
      const resp = await fetch(dataUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      // Normalize: accept both array and { features: [...] } (GeoJSON) formats
      if (Array.isArray(data)) {
        lighthouses = data;
      } else if (data.features) {
        lighthouses = data.features.map(f => ({
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          name: f.properties.name || f.properties['seamark:name'] || null,
          character: f.properties['seamark:light:character'] || f.properties.character || null,
          color: f.properties['seamark:light:colour'] || f.properties.color || 'white',
          period: parseFloat(f.properties['seamark:light:period']) || null,
          range: parseFloat(f.properties['seamark:light:range']) || null,
          height: parseFloat(f.properties['seamark:light:height']) || null,
          group: parseInt(f.properties['seamark:light:group'], 10) || null,
          sequence: f.properties['seamark:light:sequence'] || null,
        }));
      } else if (data.elements) {
        // Overpass API format
        lighthouses = data.elements
          .filter(el => el.lat != null && el.lon != null)
          .map(el => ({
            lat: el.lat,
            lon: el.lon,
            name: el.tags?.name || el.tags?.['seamark:name'] || null,
            character: el.tags?.['seamark:light:character'] || null,
            color: el.tags?.['seamark:light:colour'] || 'white',
            period: parseFloat(el.tags?.['seamark:light:period']) || null,
            range: parseFloat(el.tags?.['seamark:light:range']) || null,
            height: parseFloat(el.tags?.['seamark:light:height']) || null,
            group: parseInt(el.tags?.['seamark:light:group'], 10) || null,
            sequence: el.tags?.['seamark:light:sequence'] || null,
          }));
      }

      // Normalize color field and build display properties
      lighthouses.forEach(lh => {
        lh.colors = normalizeColors(lh.color);
        // Build a readable characteristic string if we have structured data
        if (!lh.character && lh.colors) {
          lh.character = 'F ' + lh.colors.join('');
        }
        if (lh.character && lh.period && !lh.character.includes('s')) {
          lh.character += ` ${lh.period}s`;
        }
      });

      // Pre-parse all light patterns
      parsedPatterns = lighthouses.map(lh => {
        const desc = LightPatterns.parse(lh.character);
        // Override period if we have explicit data
        if (lh.period) desc.period = lh.period;
        if (lh.group) desc.group = lh.group;
        if (lh.colors && lh.colors.length) desc.colors = lh.colors;
        return desc;
      });

      lightCountEl.textContent = lighthouses.length.toLocaleString();
      console.log(`Loaded ${lighthouses.length} lighthouses`);

      // ---- India boundary correction (SOI compliant) ----
      // CARTO/OSM tiles may show incorrect boundaries for India.
      // This overlay draws India's claimed international boundary including
      // all of J&K, POK (Azad Kashmir, Gilgit-Baltistan), and Aksai Chin,
      // as per Survey of India guidelines.
      map.addSource('india-boundary', {
        type: 'geojson',
        data: 'data/india-boundary.geojson',
      });
      map.addLayer({
        id: 'india-boundary-line',
        type: 'line',
        source: 'india-boundary',
        paint: {
          'line-color': 'rgba(200, 200, 200, 0.6)',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            2, 0.8,
            5, 1.5,
            8, 2.0,
            12, 2.5,
          ],
        },
      });

      // Dismiss loading overlay
      loadingOverlay.classList.add('hidden');

      // Start animation
      startAnimation();

    } catch (err) {
      console.error('Failed to load lighthouse data:', err);
      loadingOverlay.querySelector('.loading-text').textContent =
        'Failed to load data. Place lighthouses.json in data/ folder.';
    }
  });

  /**
   * Normalize color strings from OSM into single-letter color arrays.
   */
  function normalizeColors(raw) {
    if (!raw) return ['W'];
    const s = String(raw).toLowerCase();
    const result = [];
    if (s.includes('white'))  result.push('W');
    if (s.includes('red'))    result.push('R');
    if (s.includes('green'))  result.push('G');
    if (s.includes('yellow') || s.includes('amber')) result.push('Y');
    if (s.includes('blue'))   result.push('B');
    // Fallback
    if (result.length === 0) {
      // Try single-letter codes
      if (s.includes('w')) result.push('W');
      if (s.includes('r')) result.push('R');
      if (s.includes('g')) result.push('G');
      if (result.length === 0) result.push('W');
    }
    return result;
  }

  // ---- Animation loop ----
  function startAnimation() {
    function frame() {
      render();
      animFrameId = requestAnimationFrame(frame);
    }
    animFrameId = requestAnimationFrame(frame);
  }

  /**
   * Main render pass - called every frame.
   */
  function render() {
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Set additive blending for all light drawing
    ctx.globalCompositeOperation = 'lighter';

    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const timestamp = performance.now() / 1000; // seconds

    // Update info panel
    zoomLevelEl.textContent = zoom.toFixed(1);

    // Viewport bounds with a small margin
    const margin = 0.5; // degrees
    const south = bounds.getSouth() - margin;
    const north = bounds.getNorth() + margin;
    const west = bounds.getWest() - margin;
    const east = bounds.getEast() + margin;

    let visibleCount = 0;

    // Iterate all lighthouses
    for (let i = 0; i < lighthouses.length; i++) {
      const lh = lighthouses[i];

      // Viewport culling
      if (lh.lat < south || lh.lat > north || lh.lon < west || lh.lon > east) {
        continue;
      }

      // Project to screen
      const point = map.project([lh.lon, lh.lat]);
      const sx = point.x;
      const sy = point.y;

      // Skip if off-screen (with generous margin for beams)
      if (sx < -200 || sx > width + 200 || sy < -200 || sy > height + 200) {
        continue;
      }

      visibleCount++;

      // Get current intensity from flash pattern
      const pattern = parsedPatterns[i];
      const { intensity, colorIndex } = LightPatterns.getIntensity(pattern, timestamp);
      const color = pattern.colors[colorIndex % pattern.colors.length] || 'W';

      // Level-of-detail rendering
      if (zoom < 6) {
        // Far zoom: just glowing dots
        const dotRadius = Math.max(1.5, 2 + (zoom - 2) * 0.5);
        LightRenderer.drawLighthouseGlow(ctx, sx, sy, color, intensity * 0.8, dotRadius);

      } else if (zoom < 10) {
        // Mid zoom: larger animated dots
        const dotRadius = 3 + (zoom - 6) * 0.8;
        LightRenderer.drawLighthouseGlow(ctx, sx, sy, color, intensity, dotRadius);

      } else {
        // Close zoom: full rotating beam
        const range = lh.range || 10; // nautical miles fallback
        // Convert range to approximate pixels at current zoom
        // At zoom 10, 1 nm ~ 10px; doubles each zoom level
        const rangePixels = range * 10 * Math.pow(2, zoom - 10);
        const clampedRange = Math.min(rangePixels, 400); // cap for performance

        // Rotation: one full turn per period * 2 (typical rotation period)
        const rotPeriod = (pattern.period || 5) * 2;
        const angle = ((timestamp / rotPeriod) * Math.PI * 2) % (Math.PI * 2);

        LightRenderer.drawLighthouseBeam(ctx, sx, sy, angle, clampedRange, color, intensity);
      }
    }

    visibleCountEl.textContent = visibleCount.toLocaleString();

    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Hover / tooltip interaction ----
  // We track mouse position and find the nearest lighthouse on each frame
  let mouseX = -1000;
  let mouseY = -1000;

  mapContainer.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    handleHover(e.clientX, e.clientY);
  });

  mapContainer.addEventListener('mouseleave', () => {
    mouseX = -1000;
    mouseY = -1000;
    hoveredIndex = -1;
    Tooltip.hide();
    mapContainer.style.cursor = '';
  });

  function handleHover(clientX, clientY) {
    // Convert client coords to map container-relative coords
    const rect = mapContainer.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const west = bounds.getWest();
    const east = bounds.getEast();

    let closestDist = HOVER_RADIUS_PX;
    let closestIdx = -1;

    for (let i = 0; i < lighthouses.length; i++) {
      const lh = lighthouses[i];
      if (lh.lat < south || lh.lat > north || lh.lon < west || lh.lon > east) continue;

      const point = map.project([lh.lon, lh.lat]);
      const dx = point.x - mx;
      const dy = point.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    if (closestIdx >= 0) {
      hoveredIndex = closestIdx;
      mapContainer.style.cursor = 'pointer';
      Tooltip.show(lighthouses[closestIdx], clientX, clientY);
    } else {
      hoveredIndex = -1;
      mapContainer.style.cursor = '';
      Tooltip.hide();
    }
  }

  // ---- Keep canvas in sync with map movements ----
  map.on('move', () => {
    // The canvas overlay is fixed-position; we re-render every frame anyway,
    // so no explicit sync needed beyond the animation loop.
  });

  map.on('resize', resizeCanvas);

  // ---- Exports for debugging ----
  window.LighthouseMap = {
    getMap: () => map,
    getLighthouses: () => lighthouses,
    getPatterns: () => parsedPatterns,
  };

})();
