# Lighthouse Map

**Every lighthouse in the world, rendered with its real flash pattern.**

Live demo: [thelighthousemap.netlify.app](https://tinyurl.com/thelighthousemap)

![World view — 30,191 lighthouses with real flash patterns on a dark basemap](screenshots/initial-load.png)

## What It Does

An interactive map of 30,191 lighthouses drawn from OpenStreetMap seamark data, each rendered with its actual IALA light characteristic. If a lighthouse near Brest flashes red twice every 10 seconds in real life, it does that on the map. Zoom out and coastlines draw themselves — not by borders, but by light. Toggle to a 3D globe and watch them light up like nervous systems. Zero API keys, zero backend, zero build step.

## Built in One Claude Code Session

The entire project — data fetching, processing, map rendering, flash pattern engine, beam animation, day/night terminator, 3D globe, hover tooltips, search with color and pattern filters, Playwright testing, screen recording, and this README — was built in a single Claude Code conversation. A swarm of parallel agents handled independent workstreams while I described what I wanted and course-corrected when things looked wrong. Memory to map to render to test to record to write.

## Features

- 30,191 lighthouses with real IALA light characteristics (color, period, range, sector bearings)
- 10 flash pattern types faithfully reproduced: Fixed, Flashing, Long Flashing, Quick, Very Quick, Isophase, Occulting, Morse, Alternating, and Group patterns
- Three-tier level-of-detail rendering: glow dots at world zoom, animated flashes at mid zoom, full rotating beam cones up close
- Canvas 2D additive blending for realistic light accumulation where beams overlap
- 3D globe mode via MapLibre GL JS v5 globe projection
- Real-time day/night terminator with brightness modulation
- Search with fuzzy substring matching, color filters (white/red/green/yellow), and pattern filters
- Cinema mode for distraction-free viewing
- Major lights toggle to isolate high-range aids to navigation
- Visibility range circles proportional to actual nautical mile coverage
- India boundary rendered per Survey of India guidelines
- Zero API keys, zero backend, zero build step — runs entirely in the browser

## Architecture

Six vanilla JavaScript modules, no bundler:

| Module | Responsibility |
|---|---|
| `js/lightPatterns.js` | Parses light-character strings into time-varying intensity functions (0.0--1.0) for all 10 pattern types |
| `js/lightRenderer.js` | Renders glows and rotating beams onto a Canvas 2D overlay with additive blending and three-tier LOD |
| `js/terminator.js` | Computes the real-time day/night terminator polygon from UTC and renders it as a GeoJSON layer |
| `js/tooltip.js` | Floating tooltip on hover showing name, characteristic, range, height, and coordinates |
| `js/search.js` | Search panel with debounced substring matching, color/pattern chip filters, and fly-to navigation |
| `js/main.js` | Application core: initializes MapLibre, loads data, drives the animation loop, wires up all interaction handlers |

## Data Sources

- **Primary:** [Geodienst](https://geodienst.xyz/) seamark export from OpenStreetMap (26,000+ lights with full IALA characteristics)
- **Supplementary:** Overpass API queries for India, Middle East, and other regions with sparse seamark coverage
- **Result:** 30,191 lighthouses with valid characteristics across 10 pattern types, stored as a single flat JSON file (`data/lighthouses-full.json`)

## Quick Start

```bash
git clone https://github.com/DrishtantKaushal/lighthousemap.git
cd lighthousemap
```

Open `index.html` directly in a browser, or serve locally:

```bash
npx serve . -p 8080
# then open http://localhost:8080
```

No install. No build. No API keys.

## Tech Stack

- **MapLibre GL JS** v5.1.0 — vector tile map rendering with globe projection
- **CARTO Dark Matter** — basemap tiles (no API key required)
- **Canvas 2D** — light beam and glow rendering with additive blending
- **Vanilla JavaScript** — no framework, no bundler, no transpiler

## License

MIT
