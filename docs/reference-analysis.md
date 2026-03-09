# Reference Analysis: geodienst/lighthousemap

> Source: [github.com/geodienst/lighthousemap](https://github.com/geodienst/lighthousemap)
> Live demo: [geodienst.github.io/lighthousemap](https://geodienst.github.io/lighthousemap/)
> Analysis date: 2026-03-09

---

## 1. Repository Structure

```
.github/workflows/
LICENSE (MIT)
README.md
data-full.json            # Pre-extracted full dataset from Overpass API
data.json                 # Smaller test dataset
index.html                # Single-page app (all main JS inline)
leaflet.indexedfeaturelayer.js   # Spatial index layer (rbush)
leaflet.light.js          # Light sequence parser + animation state machine
leaflet.rangedmarker.js   # Range circle visualization
```

**Key insight**: This is a remarkably compact project -- the entire lighthouse visualization fits in ~4 files totaling ~400 lines of code. There is no build system, no bundler, no framework. Just vanilla JS extending Leaflet.

---

## 2. Architecture Overview

```
Overpass API (or pre-fetched data-full.json)
        |
        v
  osmtogeojson (library)
        |
        v
  GeoJSON features with OSM tags
        |
        v
  L.IndexedFeatureLayer (spatial index via rbush)
        |
        v
  L.Light circles (one per beacon, extend L.Circle)
        |
        v
  requestAnimationFrame loop
     calls sequence.state(t) for each visible marker
     updates fill color (or turns off)
```

---

## 3. Light Sequence Parsing (`leaflet.light.js`)

### 3.1 Data Source: OSM Seamark Tags

The parser reads these OSM tags from each feature:

| Tag | Purpose |
|-----|---------|
| `seamark:light:character` | Light type abbreviation (Fl, Oc, Iso, Q, LFl, Mo, F, FFl, Al.) |
| `seamark:light:colour` | Color(s), semicolon-separated (e.g., `red;white`) |
| `seamark:light:sequence` | Timing pattern (e.g., `1+(3)` = 1s on, 3s off) |
| `seamark:light:period` | Total cycle period in seconds |
| `seamark:light:group` | Number of flashes in a group |
| `seamark:light:range` | Visibility range in nautical miles |
| `seamark:light:1:*` | Alternate tag format (renameProperty normalizes these) |

### 3.2 Tag Normalization

The `renameProperty()` function handles a common OSM data inconsistency: some beacons use `seamark:light:1:character` instead of `seamark:light:character`. The parser copies `1:` prefixed tags to the unprefixed form if the unprefixed tag doesn't already exist.

### 3.3 Character Type Handling

The main `L.Light.sequence(tags, fallbackColor)` function is a ~100-line state machine that normalizes various light character types into a uniform `Sequence` format:

| Character | Name | Parser Behavior |
|-----------|------|-----------------|
| **F** | Fixed | Returns `L.Light.Fixed(color)` -- always on |
| **Fl** | Flashing | Parses `sequence` string into on/off intervals |
| **LFl** | Long Flashing | Treated same as Fl (long flash >= 2s) |
| **Oc** | Occulting | Parsed like Fl (sequence encodes eclipse intervals) |
| **Iso** | Isophase | Equal light/dark; if no sequence given, splits period in half |
| **Q** | Quick | Fast flashing (0.2s flash); complex group handling |
| **Mo** | Morse | Parsed same as Fl (sequence encodes dots/dashes) |
| **FFl** | Fixed + Flashing | Converted to Fl with computed on/off times |
| **Al.X** | Alternating | Strips `Al.` prefix, processes inner character |

### 3.4 Sequence String Format

The sequence string uses this grammar:

```
sequence = step ("+" step)*
step     = duration          // light ON for <duration> seconds
         | "(" duration ")"  // light OFF (eclipse) for <duration> seconds
duration = float
```

Examples:
- `1+(3)` = 1s flash, 3s dark
- `0.5+(0.5)+0.5+(4.5)` = two 0.5s flashes separated by 0.5s dark, then 4.5s dark
- `1+(1)+1+(1)+1+(7)` = three 1s flashes with 1s gaps, then 7s dark

### 3.5 Special Conversions

Several `if` blocks handle edge cases where the raw OSM data doesn't directly map to the on/off sequence format:

1. **Iso without sequence**: If period is given (e.g., 6s), generates `3+(3)`.
2. **Fl/LFl/IQ with bare number**: If sequence is just a number (e.g., `1`), it's the flash duration. Dark time = period - flash.
3. **FFl with bare number**: Computes flash/dark from sequence and period.
4. **Q+LFL compound**: Quick flashes followed by a long flash. Generates a synthetic sequence of 0.2s quick flashes + 1.0s long flash + computed remainder.
5. **Q with group**: Distributes a total sequence time evenly across N flashes.

### 3.6 Color Handling

Colors come as semicolon-separated strings from `seamark:light:colour`. For multi-color lights (e.g., `red;white`), each sub-sequence gets its own color. A bracket notation `[R.]` in the sequence string can override color assignment:

```javascript
// e.g., sequence = "[R.]1+(1),[W.]1+(1)"
let letter = sequence.match(/^\[([A-Z]+)\.\](.+)$/);
// Maps [R.] -> 'red', [W.] -> 'white' by regex match on color name
```

Fallback color is `#FF0` (yellow) if no color data exists.

---

## 4. Animation System

### 4.1 Class Hierarchy

```
L.Light (extends L.Circle)
  - setColor(color)    // updates fillColor, avoids redundant style changes

L.Light.Fixed
  - state(time) -> always returns this.color

L.Light.Sequence
  - constructor(seq, color)
  - setSequence(seq, color)  // parses "1+(3)" into steps array
  - state(time) -> color or false

L.Light.CombinedSequence
  - constructor(sequences[])
  - state(time) -> delegates to appropriate sub-sequence based on time offset
```

### 4.2 The `state(time)` Function

This is the core animation primitive. Given a time `t` in **seconds** (float), it returns either:
- A **color string** (e.g., `"red"`, `"#FF0"`) if the light is ON
- `false` if the light is OFF (eclipse)

The function works by:
1. Computing `dt = (offset + time) % duration` to get position within the cycle
2. Walking through `steps[]` array, subtracting each step's duration
3. When `dt` falls within a step, returning that step's state (color or false)

### 4.3 Random Phase Offset

**Critical detail for visual realism**: Each `Sequence` and `CombinedSequence` gets a random offset:

```javascript
this.offset = Math.random() * this.duration;
```

This means two lighthouses with identical flash patterns will NOT blink in sync -- they'll be at random points in their cycle. This is essential for visual authenticity since real lighthouses are not synchronized.

### 4.4 The Animation Loop

In `index.html`, the animation uses `requestAnimationFrame`:

```javascript
let update = function(t) {
    draw(t / 1000);          // Convert ms to seconds
    requestAnimationFrame(update);
};

let draw = function(t) {
    layer.eachVisibleLayer(marker => {
        var state = marker.options.sequence.state(t);
        marker.setColor(state ? (useRealColors ? state : '#FF0') : false);
    });
};

update(0);
```

Key points:
- `requestAnimationFrame` provides the timestamp in milliseconds; divided by 1000 for the sequence parser
- Only **visible** markers are updated (see performance section)
- The `setColor` method on `L.Light` short-circuits if the color hasn't changed:
  ```javascript
  if (this._color !== color) { ... }
  ```
  This avoids unnecessary DOM mutations -- a critical micro-optimization when updating hundreds of markers 60 times per second.

### 4.5 Real Colors Toggle

A checkbox lets users switch between real maritime colors (red, green, white, etc.) and a uniform yellow (`#FF0`). When real colors are off, all "on" states render as yellow regardless of the actual color data.

---

## 5. Performance Strategy

### 5.1 Spatial Indexing with rbush (`leaflet.indexedfeaturelayer.js`)

This is the most important performance optimization. `L.IndexedFeatureLayer` extends `L.GeoJSON` with:

1. **R-tree index** using [rbush](https://github.com/mourner/rbush): All features are inserted into an R-tree spatial index on load.
2. **Viewport culling**: On every `moveend` event, it queries the R-tree for features intersecting the current viewport (with 30px padding).
3. **Incremental DOM updates**: The `updateLayers()` method diffs the current visible set against the new visible set, only adding/removing what changed.

```javascript
// Query spatial index for visible features
search(bounds) {
    return this._rbush.search(bounds.toMinMax()).map(result => result.layer);
}

// Diff and update DOM
_redraw() {
    const layers = this.search(this._getBounds());
    this._visible.updateLayers(layers);
}
```

### 5.2 Only Animate Visible Markers

The animation loop calls `layer.eachVisibleLayer()`, NOT `layer.eachLayer()`. This means:
- If 10,000 beacons are loaded but only 50 are visible, only 50 `state()` calls + 50 `setColor()` calls happen per frame
- Off-screen markers have zero per-frame cost

### 5.3 Pre-fetched Data

The project avoids live Overpass API queries in production. Instead, `data-full.json` is pre-generated (likely via a nightly CI job in `.github/workflows/`). This eliminates:
- Long initial load times (Overpass queries can take minutes for global datasets)
- Rate limiting issues
- Variable response times

The commented-out code shows the Overpass query approach was the original design:
```javascript
url = 'data-full.json'; // For testing
```

### 5.4 No Canvas/WebGL -- Pure SVG/DOM

Surprisingly, the project uses standard Leaflet SVG circles (L.Circle), not canvas or WebGL. This works because:
- The spatial index ensures at most ~100-200 circles are in the DOM at any time
- The `setColor` short-circuit avoids unnecessary style mutations
- SVG circles are lightweight DOM elements compared to complex markers

### 5.5 Polygon-to-Point Conversion

For features that are polygons (e.g., lighthouse buildings mapped as areas), `turf.centroid()` converts them to point features. This ensures uniform rendering:
```javascript
feature.geometry.type == 'Polygon'
    ? Object.assign({}, feature, {geometry: turf.centroid(feature).geometry})
    : feature;
```

---

## 6. Data Structures

### 6.1 Per-Light Structure (L.Light instance)

```javascript
{
    // Inherited from L.Circle:
    _latlng: { lat, lng },
    _mRadius: range_in_meters,   // seamark:light:range * 1852 (nm to m)

    // Custom:
    _color: 'red' | '#FF0' | false,

    options: {
        interactive: false,     // No click/hover events (saves memory)
        radius: range_nm * 1852,
        sequence: L.Light.Sequence | L.Light.CombinedSequence | L.Light.Fixed,
        stroke: false,          // No circle border
        fillOpacity: 0.9,
        fill: boolean,          // Initial fill state
        fillColor: string       // Initial color
    }
}
```

### 6.2 Sequence Step Array

```javascript
// L.Light.Sequence.steps
[
    [color_or_false, duration_seconds],  // e.g., ["red", 1.0]
    [false, 3.0],                        // eclipse
    ...
]
```

### 6.3 Combined Sequence

```javascript
// L.Light.CombinedSequence
{
    sequences: [L.Light.Sequence, ...],  // Sub-sequences run back-to-back
    duration: total_seconds,              // Sum of all sub-sequence durations
    offset: random_float                  // Phase offset for desynchronization
}
```

### 6.4 Spatial Index Entry

```javascript
// rbush entry
{
    minX: west_lng,
    minY: south_lat,
    maxX: east_lng,
    maxY: north_lat,
    layer: L.Light_instance
}
```

---

## 7. Clever Techniques Summary

### 7.1 Random Phase Offset
Each light gets `Math.random() * duration` as its offset, ensuring lights with identical patterns don't blink in lockstep. Simple but critical for realism.

### 7.2 Short-Circuit Color Updates
`setColor()` checks `this._color !== color` before calling `setStyle()`. With 200 visible lights at 60fps, this prevents 12,000 unnecessary DOM style operations per second for any light that stays in the same state across frames (most of them, since flash durations are typically 0.5-3s).

### 7.3 Fallback Sequence on Parse Error
If a light's OSM data can't be parsed, instead of hiding it, a simple `1+(1)` (1s on, 1s off) fallback is used:
```javascript
} catch (e) {
    sequence = L.Light.sequence({ 'seamark:light:sequence': '1+(1)' });
}
```

### 7.4 interactive: false
Passing `interactive: false` to each L.Light disables Leaflet's click/hover event handling. This avoids creating event listeners for thousands of circles that don't need interaction.

### 7.5 Viewport-Only Animation
The `eachVisibleLayer()` pattern ensures the animation loop only touches DOM elements currently in the viewport. This is the single biggest performance win.

### 7.6 Dark Base Map
Using CartoDB dark tiles (`dark_all`) makes the colored light circles pop visually. This is a deliberate aesthetic choice that mirrors how navigators see lights at night.

### 7.7 Range-Based Circle Size
Each light's circle radius is `range_nm * 1852` meters (nautical miles to meters). This means at zoomed-out views, long-range lights appear as large glowing circles while short-range buoys are tiny dots -- matching real-world visibility.

---

## 8. IALA Light Character Reference

For implementing our own parser, here are the standard maritime light characters:

| Abbr | Name | Description |
|------|------|-------------|
| **F** | Fixed | Continuous steady light |
| **Fl** | Flashing | Single flash per period (dark > light) |
| **Fl(N)** | Group Flashing | N flashes in a group per period |
| **LFl** | Long Flashing | Flash duration 2-5 seconds |
| **Q** | Quick | ~60 flashes/minute |
| **VQ** | Very Quick | ~120 flashes/minute |
| **UQ** | Ultra Quick | ~240 flashes/minute |
| **Oc** | Occulting | Steady light with periodic eclipses (light > dark) |
| **Iso** | Isophase | Equal duration light and dark |
| **Mo(A)** | Morse | Light pattern encodes Morse letter (e.g., A = dot-dash) |
| **Al.** | Alternating | Alternates between two colors |
| **FFl** | Fixed + Flashing | Steady light with periodic brighter flashes |
| **Q+LFl** | Quick + Long Flash | Group of quick flashes followed by one long flash |

Standard periods: Most lights have 3-10 second periods. Notable exceptions: Fl(5) 20s, Q(9) 15s, Q(6)+LFl 15s.

Sources: [IALA Recommendation E-110](https://www.iala.int/content/uploads/2017/03/E-110-Ed.4-Rhythmic-Characters-of-Lights-on-Aids-to-Navigation_16Dec2016.pdf), [Wikipedia: Light characteristic](https://en.wikipedia.org/wiki/Light_characteristic)

---

## 9. Other Lighthouse Visualization Projects and Techniques

### 9.1 Canvas-Based High-Performance Maps
For scaling beyond SVG (10,000+ animated markers), research points to:
- **HTML5 Canvas tiling**: Draw markers to canvas tiles once per zoom level; move tiles instead of individual DOM elements ([SeatGeek approach](https://chairnerd.seatgeek.com/high-performance-map-interactions-using-html5-canvas/))
- **Leaflet.Canvas-Markers**: Plugin renders icons on canvas instead of DOM ([GitHub](https://github.com/eJuke/Leaflet.Canvas-Markers))
- **WebGL rendering**: Using deck.gl or custom WebGL layers for 100k+ animated points
- **OffscreenCanvas + Web Workers**: Move rendering off main thread ([Evil Martians guide](https://evilmartians.com/chronicles/faster-webgl-three-js-3d-graphics-with-offscreencanvas-and-web-workers))

### 9.2 L7 (AntV)
WebGL-based geo-visualization framework supporting "water ripple effect" and "city lighting effect" on point layers -- potentially useful for lighthouse glow effects. [Medium article](https://medium.com/@lzxue/make-animated-maps-l7-2-0-7bc28d2e1212)

### 9.3 Leaflet Animation Approaches
- **Leaflet.MovingMarker**: Uses `L.Util.requestAnimFrame` for smooth marker animation with linear interpolation
- **supercluster**: For clustering at extreme zoom-out levels (better than markercluster for 100k+ points)
- **Custom `requestAnimationFrame`** loops (as geodienst does) remain the standard for per-frame state updates

### 9.4 OpenSeaMap
The [OpenSeaMap](https://www.openseamap.org/) project renders full nautical charts from OSM data, including light sectors and characteristics, but uses static rendering rather than animated lights.

---

## 10. Recommendations for Our Implementation

Based on this analysis, the geodienst approach provides a strong foundation. Key takeaways:

1. **Copy the sequence parser logic** -- it handles the messy real-world OSM data well, with numerous edge-case normalizations.
2. **Use the `state(time)` pattern** -- a pure function from time to color is clean, testable, and composable.
3. **Keep random phase offsets** -- essential for visual realism.
4. **Implement viewport culling early** -- the spatial index is non-negotiable for performance.
5. **Consider WebGL/Canvas for scale** -- geodienst uses SVG circles which works for ~200 visible lights, but if we want glow effects, halos, or smoother animations, a canvas-based renderer would be more performant.
6. **Pre-fetch data** -- don't rely on live Overpass queries; use pre-generated GeoJSON.
7. **Dark base map** -- essential for the visual effect. CartoDB dark tiles or similar.
8. **Add missing characters** -- geodienst doesn't handle VQ (Very Quick) or UQ (Ultra Quick). We should add these.
9. **Consider glow/halo effects** -- geodienst uses plain filled circles. Adding a radial gradient or CSS glow would significantly improve visual appeal.
10. **Light sectors** -- geodienst ignores `sector_start`/`sector_end` tags. Rendering directional light sectors would add navigational accuracy.
