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
  let activeColorFilter = 'all'; // 'all', 'W', 'R', 'G', 'Y' - for search/filter panel
  let activePatternFilter = 'all'; // 'all', 'fixed', 'flashing', 'quick', 'occulting'
  let showMajorOnly = false;
  let showRangeCircles = false;
  let isCinemaMode = false;
  let highlightedIndex = -1;    // index of lighthouse to highlight (from search)

  // Globe / terminator state
  let isGlobe = false;
  let isTerminatorVisible = false;  // day/night overlay off by default
  let terminatorUpdateTimer = null;
  let indiaBoundaryData = 'data/india-boundary.geojson'; // cached after first fetch

  // Flash pattern category mapping
  function categorizePattern(character) {
    if (!character) return 'fixed';
    const c = character.toUpperCase();
    if (c.startsWith('Q') || c.startsWith('VQ') || c.startsWith('UQ') || c.startsWith('IQ')) return 'quick';
    if (c.startsWith('OC')) return 'occulting';
    if (c.startsWith('ISO')) return 'isophase';
    if (c.startsWith('MO')) return 'morse';
    if (c.startsWith('FL') || c.startsWith('LFL') || c.startsWith('AL')) return 'flashing';
    if (c === 'F' || c.startsWith('F ')) return 'fixed';
    return 'flashing'; // default to flashing for unknown
  }

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
      // Use full dataset by default; ?lite for smaller set
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

      // ---- Categorize each lighthouse and compute derived fields ----
      const colorHexMap = { W: '#fffbe6', R: '#ff3b30', G: '#30d158', Y: '#ffd60a', B: '#4488ff' };
      lighthouses.forEach((lh, i) => {
        lh._patternCategory = categorizePattern(parsedPatterns[i].type === 'F' ? 'F' : lh.character);
        lh._isMajor = (lh.range || 0) >= 15;
      });
      console.log('Categorized lighthouses');

      // ---- Add all map layers (each in its own try/catch to not block others) ----

      // 1. India boundary (fetch + add)
      try {
        const ibResp = await fetch('data/india-boundary.geojson');
        if (ibResp.ok) indiaBoundaryData = await ibResp.json();
        map.addSource('india-boundary', { type: 'geojson', data: indiaBoundaryData });
        map.addLayer({
          id: 'india-boundary-line', type: 'line', source: 'india-boundary',
          paint: {
            'line-color': 'rgba(200, 200, 200, 0.6)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 5, 1.5, 8, 2.0, 12, 2.5],
          },
        });
        console.log('India boundary added');
      } catch (e) { console.error('India boundary failed:', e); }

      // 2. Day/night terminator
      try {
        const terminatorGeoJSON = Terminator.generateTerminatorGeoJSON();
        map.addSource('terminator', { type: 'geojson', data: terminatorGeoJSON });
        map.addLayer({
          id: 'night-overlay', type: 'fill', source: 'terminator',
          paint: { 'fill-color': 'rgba(0, 0, 20, 0.4)', 'fill-opacity': 0.4 },
        }, map.getLayer('india-boundary-line') ? 'india-boundary-line' : undefined);
        map.setLayoutProperty('night-overlay', 'visibility', 'none');
        terminatorUpdateTimer = setInterval(() => {
          const src = map.getSource('terminator');
          if (src) src.setData(Terminator.generateTerminatorGeoJSON());
        }, 60000);
        console.log('Terminator added');
      } catch (e) { console.error('Terminator failed:', e); }

      // 3. Lighthouse points GeoJSON + visibility range circles
      try {
        const lhFeatures = lighthouses.map((lh, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lh.lon, lh.lat] },
          properties: {
            idx: i,
            color: colorHexMap[(lh.colors && lh.colors[0]) || 'W'] || colorHexMap.W,
            range: lh.range || 5,
            isMajor: lh._isMajor,
            category: lh._patternCategory,
          },
        }));
        map.addSource('lighthouse-points', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: lhFeatures },
        });
        console.log('Lighthouse points source added');

        // Always-visible translucent glow halo around each lighthouse
        map.addLayer({
          id: 'lighthouse-glow', type: 'circle', source: 'lighthouse-points',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'],
              2, ['case', ['get', 'isMajor'], 4, 2],
              6, ['case', ['get', 'isMajor'], 8, 4],
              10, ['case', ['get', 'isMajor'], 14, 8],
              14, ['case', ['get', 'isMajor'], 20, 12]
            ],
            'circle-color': ['get', 'color'],
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.06, 6, 0.08, 10, 0.05, 14, 0.03],
            'circle-blur': 1,
          },
        });
        console.log('Lighthouse glow layer added');

        function rangeScale(z) { return 1852 * Math.pow(2, z) / (156543 * 0.643); }

        map.addLayer({
          id: 'lighthouse-range', type: 'circle', source: 'lighthouse-points', minzoom: 6,
          paint: {
            'circle-radius': ['*', ['get', 'range'], rangeScale(map.getZoom())],
            'circle-color': ['get', 'color'],
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 8, 0.03, 12, 0.06, 14, 0.07],
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 10, 0.8, 14, 1.5],
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 8, 0.15, 12, 0.3, 14, 0.4],
          },
          layout: { visibility: 'none' },
        });
        console.log('Range circles layer added');

        map.on('zoom', () => {
          if (showRangeCircles && map.getLayer('lighthouse-range')) {
            map.setPaintProperty('lighthouse-range', 'circle-radius',
              ['*', ['get', 'range'], rangeScale(map.getZoom())]
            );
          }
        });
      } catch (e) { console.error('Lighthouse points/range failed:', e); }

      // Initialize search panel
      Search.init(lighthouses, map);

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

      // Major-only filter
      if (showMajorOnly && !lh._isMajor) continue;

      // Color filter
      if (activeColorFilter !== 'all') {
        const colors = lh.colors || ['W'];
        const hasColor = colors.some(c => {
          const letter = typeof c === 'string' && c.length > 1
            ? (c === 'white' ? 'W' : c === 'red' ? 'R' : c === 'green' ? 'G' : c === 'yellow' ? 'Y' : c === 'blue' ? 'B' : 'W')
            : (c || 'W');
          return letter === activeColorFilter;
        });
        if (!hasColor) continue;
      }

      // Flash pattern filter
      if (activePatternFilter !== 'all' && lh._patternCategory !== activePatternFilter) continue;

      // Project to screen
      const point = map.project([lh.lon, lh.lat]);
      const sx = point.x;
      const sy = point.y;

      // Skip if off-screen (with generous margin for beams/sectors)
      if (sx < -600 || sx > width + 600 || sy < -600 || sy > height + 600) {
        continue;
      }

      visibleCount++;

      // Get current intensity from flash pattern
      const pattern = parsedPatterns[i];
      let { intensity, colorIndex } = LightPatterns.getIntensity(pattern, timestamp);
      const color = pattern.colors[colorIndex % pattern.colors.length] || 'W';

      // Modulate brightness based on day/night: lighthouses in daylight
      // render at reduced brightness (they're less visible during the day)
      if (isTerminatorVisible) {
        const inDarkness = Terminator.isNight(lh.lat, lh.lon);
        if (!inDarkness) {
          intensity *= 0.85; // 85% brightness in daylight
        }
      }

      // Draw sectors BEFORE the beam/glow so beam renders on top
      if (zoom >= 8 && lh.sectors && lh.sectors.length > 0) {
        LightRenderer.drawLighthouseSectors(ctx, sx, sy, lh.sectors, zoom, map, lh);
      }

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

      // Draw highlight ring for search result
      if (i === highlightedIndex) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        const hlTime = (timestamp * 2) % 1;
        const hlRadius = 15 + hlTime * 20;
        const hlAlpha = 1 - hlTime;
        ctx.strokeStyle = `rgba(255, 255, 220, ${hlAlpha * 0.8})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, hlRadius, 0, Math.PI * 2);
        ctx.stroke();
        // Static inner ring
        ctx.strokeStyle = 'rgba(255, 255, 220, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
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
  map.on('move', render);
  map.on('resize', resizeCanvas);

  // ---- Globe toggle (requires MapLibre GL JS v5+) ----
  document.getElementById('globe-toggle').addEventListener('click', () => {
    isGlobe = !isGlobe;

    map.setProjection({ type: isGlobe ? 'globe' : 'mercator' });

    const btn = document.getElementById('globe-toggle');
    btn.textContent = isGlobe ? '\uD83D\uDDFA\uFE0F' : '\uD83C\uDF0D';
    btn.title = isGlobe ? 'Switch to flat map' : 'Switch to 3D globe';
    btn.classList.toggle('active', isGlobe);

    // Dark atmosphere for globe mode
    if (isGlobe) {
      map.setSky({
        'sky-color': '#0a0a1a',
        'sky-horizon-blend': 0.5,
        'horizon-color': '#0d0d20',
        'horizon-fog-blend': 0.8,
        'fog-color': '#080815',
        'fog-ground-blend': 0.9,
      });
    } else {
      map.setSky(undefined);
    }

    // Re-add layers if projection change caused them to be dropped
    setTimeout(() => {
      if (lighthouses.length > 0 && !map.getSource('india-boundary')) {
        reAddDataLayers();
      }
    }, 500);
  });

  // ---- Terminator (day/night) toggle ----
  document.getElementById('terminator-toggle').addEventListener('click', () => {
    isTerminatorVisible = !isTerminatorVisible;

    const btn = document.getElementById('terminator-toggle');
    btn.classList.toggle('active', isTerminatorVisible);
    btn.title = isTerminatorVisible ? 'Hide day/night overlay' : 'Show day/night overlay';

    // Toggle the map layer visibility
    if (map.getLayer('night-overlay')) {
      map.setLayoutProperty(
        'night-overlay',
        'visibility',
        isTerminatorVisible ? 'visible' : 'none'
      );
    }
  });

  // ---- Flash pattern filter ----
  document.querySelectorAll('.pattern-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const filter = chip.dataset.pattern;
      activePatternFilter = filter;
      document.querySelectorAll('.pattern-chip').forEach(c => c.classList.toggle('active', c.dataset.pattern === filter));
    });
  });

  // ---- Major lights only toggle ----
  document.getElementById('major-toggle').addEventListener('change', (e) => {
    showMajorOnly = e.target.checked;
    // Also filter the range circle layer
    if (map.getLayer('lighthouse-range')) {
      map.setFilter('lighthouse-range', showMajorOnly ? ['==', ['get', 'isMajor'], true] : null);
    }
  });

  // ---- Visibility range circles toggle ----
  document.getElementById('range-toggle').addEventListener('change', (e) => {
    showRangeCircles = e.target.checked;
    if (map.getLayer('lighthouse-range')) {
      map.setLayoutProperty('lighthouse-range', 'visibility', showRangeCircles ? 'visible' : 'none');
      if (showRangeCircles) {
        // Force radius update for current zoom
        map.setPaintProperty('lighthouse-range', 'circle-radius',
          ['*', ['get', 'range'], 1852 * Math.pow(2, map.getZoom()) / (156543 * 0.643)]
        );
      }
    }
  });

  // ---- Cinema mode (dimmed no-label basemap) ----
  const STYLE_DEFAULT = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const STYLE_CINEMA = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';

  document.getElementById('cinema-toggle').addEventListener('change', (e) => {
    isCinemaMode = e.target.checked;
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const currentBearing = map.getBearing();
    const currentPitch = map.getPitch();

    map.setStyle(isCinemaMode ? STYLE_CINEMA : STYLE_DEFAULT);

    // Restore position and re-add sources/layers after style loads
    // MapLibre v5: 'style.load' doesn't fire after setStyle(); use 'idle' instead
    map.once('idle', () => {
      map.jumpTo({ center: currentCenter, zoom: currentZoom, bearing: currentBearing, pitch: currentPitch });

      // Dim the basemap in cinema mode
      if (isCinemaMode) {
        const style = map.getStyle();
        if (style && style.layers) {
          style.layers.forEach(layer => {
            if (layer.type === 'background') {
              map.setPaintProperty(layer.id, 'background-color', '#050508');
            }
          });
        }
      }

      // Re-add all data sources and layers
      reAddDataLayers();
    });
  });

  // Re-add data layers after style change (cinema mode toggle or globe)
  function reAddDataLayers() {
    // Re-add India boundary using cached GeoJSON
    if (!map.getSource('india-boundary')) {
      map.addSource('india-boundary', { type: 'geojson', data: indiaBoundaryData });
      map.addLayer({
        id: 'india-boundary-line', type: 'line', source: 'india-boundary',
        paint: {
          'line-color': 'rgba(200, 200, 200, 0.6)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 5, 1.5, 8, 2.0, 12, 2.5],
        },
      });
    }

    // Re-add terminator
    if (!map.getSource('terminator')) {
      map.addSource('terminator', { type: 'geojson', data: Terminator.generateTerminatorGeoJSON() });
      map.addLayer({
        id: 'night-overlay', type: 'fill', source: 'terminator',
        paint: { 'fill-color': 'rgba(0, 0, 20, 0.4)', 'fill-opacity': 0.4 },
      }, map.getLayer('india-boundary-line') ? 'india-boundary-line' : undefined);
      map.setLayoutProperty('night-overlay', 'visibility', isTerminatorVisible ? 'visible' : 'none');
    }

    // Re-add lighthouse points + range circles
    if (!map.getSource('lighthouse-points')) {
      const colorHexMap2 = { W: '#fffbe6', R: '#ff3b30', G: '#30d158', Y: '#ffd60a', B: '#4488ff' };
      const features = lighthouses.map((lh, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lh.lon, lh.lat] },
        properties: {
          idx: i,
          color: colorHexMap2[(lh.colors && lh.colors[0]) || 'W'] || colorHexMap2.W,
          range: lh.range || 5,
          isMajor: lh._isMajor,
          category: lh._patternCategory,
        },
      }));
      map.addSource('lighthouse-points', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: 'lighthouse-glow', type: 'circle', source: 'lighthouse-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            2, ['case', ['get', 'isMajor'], 4, 2],
            6, ['case', ['get', 'isMajor'], 8, 4],
            10, ['case', ['get', 'isMajor'], 14, 8],
            14, ['case', ['get', 'isMajor'], 20, 12]
          ],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.06, 6, 0.08, 10, 0.05, 14, 0.03],
          'circle-blur': 1,
        },
      });
      map.addLayer({
        id: 'lighthouse-range', type: 'circle', source: 'lighthouse-points', minzoom: 6,
        paint: {
          'circle-radius': ['*', ['get', 'range'], 1852 * Math.pow(2, map.getZoom()) / (156543 * 0.643)],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 8, 0.03, 12, 0.06, 14, 0.07],
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 10, 0.8, 14, 1.5],
          'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 8, 0.15, 12, 0.3, 14, 0.4],
        },
        layout: { visibility: showRangeCircles ? 'visible' : 'none' },
      });
      if (showMajorOnly) {
        map.setFilter('lighthouse-range', ['==', ['get', 'isMajor'], true]);
      }
    }

    // Re-apply globe if active
    if (isGlobe) {
      map.setProjection({ type: 'globe' });
      map.setSky({
        'sky-color': '#0a0a1a', 'sky-horizon-blend': 0.5,
        'horizon-color': '#0d0d20', 'horizon-fog-blend': 0.8,
        'fog-color': '#080815', 'fog-ground-blend': 0.9,
      });
    }
  }

  // ---- Exports for debugging and search integration ----
  window.LighthouseMap = {
    getMap: () => map,
    getLighthouses: () => lighthouses,
    getPatterns: () => parsedPatterns,
    setColorFilter: (filter) => { activeColorFilter = filter; },
    getColorFilter: () => activeColorFilter,
    setPatternFilter: (filter) => { activePatternFilter = filter; },
    getPatternFilter: () => activePatternFilter,
    setHighlightedIndex: (idx) => { highlightedIndex = idx; },
    getHighlightedIndex: () => highlightedIndex,
  };

})();
