# LinkedIn Post — LighthouseMap

---

Before GPS, before satellites, before radio — there were lighthouses.

For centuries, a single beam of light was the difference between safe harbor and shipwreck. Every lighthouse spoke its own language: a unique rhythm of flashes, colors, and rotations that told sailors exactly where they were in the dark.

That language is still alive. And I wanted to see all of it at once.

So I built **LighthouseMap** — an interactive map of every lighthouse in the world.

🗺️ **17,851 lights**, each one rendered with its real characteristics:
- Correct colors (white, red, green, yellow)
- Faithful flash patterns — Flashing, Isophase, Occulting, Quick, Morse code, Group flashing, Alternating
- Rotation speeds matching actual periods
- Beam ranges proportional to real nautical mile coverage

Zoom out and you see coastlines drawn not by borders, but by light. The shipping lanes of the English Channel. The dense clusters around Scandinavia. The lonely beacons dotting Pacific islands. It's a map of everywhere humanity said: *someone might be lost here — let's help them find their way.*

The entire thing runs in the browser — MapLibre GL JS for the map, Canvas 2D with additive blending for the glowing beams, CARTO Dark Matter tiles for that midnight-ocean aesthetic. No API keys needed. Fully open source.

Data comes from OpenStreetMap's seamark database (26,000+ lights, processed down to 17,851 with valid characteristics).

The fun part? The whole project was built in a single Claude Code session. From data processing to the final rotating beams — one conversation, one sitting.

Hover over any light to see its name, characteristic notation, range, and height. It's part data visualization, part maritime heritage archive.

If you've ever stood at a coast and watched a lighthouse pulse in the dark, you know why this was worth building.

🔗 Check it out: [REPO_URL]

#OpenSource #DataVisualization #MapLibreGL #Maritime #WebDev
