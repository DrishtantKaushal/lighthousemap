# LinkedIn Post — LighthouseMap

---

**Ethan Mollick posted a lighthouse map built with Claude Code. I took the prompt and went further. Here's what happened.**

Mollick's prompt asked for lighthouses in North America and Europe — dim map, correct colors, right rotation speeds, hover for details.

I wanted the entire world. And I wanted it accurate.

**The result: 17,851 lighthouses. Every one rendered with its real light characteristic.**

Not approximate. Real. Each light has its actual flash pattern (flashing, isophase, occulting, quick, Morse code, group flashing, alternating), its correct color (white, red, green, yellow), its actual rotation period, and its beam range proportional to real nautical mile coverage.

Zoom out and coastlines draw themselves — not by borders, by light. The English Channel is a wall of beams. Scandinavia is dense with them. Pacific islands pulse as lonely dots in the dark.

**Here's what made this interesting:**

**1. The data is richer than you'd expect.**
OpenStreetMap's seamark database has 26,000+ lights with full IALA light characteristics — `seamark:light:character`, `seamark:light:colour`, `seamark:light:period`, `seamark:light:range`. Processed down to 17,851 with valid characteristics. 10 pattern types. Sector data for thousands of lights.

**2. The rendering is all Canvas 2D with additive blending.**
`globalCompositeOperation = 'lighter'` — overlapping beams accumulate light realistically. Radial gradients for falloff. 3-tier level of detail: glowing dots at world zoom, animated flashes at mid-zoom, full rotating beam cones at close zoom. No WebGL. No Three.js. Just Canvas.

**3. Zero API keys.**
MapLibre GL JS (open source Mapbox fork) + CARTO Dark Matter vector tiles. No tokens. No usage limits. No backend. Runs entirely in the browser.

**4. Security-audited before push.**
XSS checks on all tooltip content. No eval(). No secrets. Pinned CDN versions. SRI-ready. The security audit is in the repo.

**5. Built in one Claude Code session.**
Data fetching, processing, map rendering, flash pattern engine, beam animation, hover tooltips, India boundary fix, English labels, security scan, Playwright testing — single conversation. Swarm of parallel agents for independent workstreams.

The whole project — from Mollick's prompt to 17,851 working lighthouses — took one sitting.

**The meta-observation:**
The prompt was the same. The ambition was different. "North America and Europe" vs "every lighthouse in the world" is a 10x scope increase that didn't require 10x effort. That's the leverage.

Open source. No API keys. Clone and run.

https://github.com/DrishtantKaushal/lighthousemap

---

#OpenSource #DataVisualization #ClaudeCode #Maritime #WebDev #AgenticAI
