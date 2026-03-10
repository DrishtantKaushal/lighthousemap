/**
 * lightRenderer.js
 * ----------------
 * Renders lighthouse glows and rotating light beams onto a canvas overlay
 * using additive blending for realistic light accumulation.
 */

const LightRenderer = (() => {

  // Color palette for light colors
  // Each entry: [R, G, B] at full intensity
  const COLOR_MAP = {
    W: [255, 255, 220],  // warm white
    R: [255, 60, 60],    // red
    G: [60, 255, 60],    // green
    Y: [255, 255, 60],   // yellow / amber
    B: [60, 120, 255],   // blue (rare but exists)
  };

  /**
   * Resolve a color letter to an RGBA string.
   */
  function colorRGBA(letter, alpha) {
    const c = COLOR_MAP[letter] || COLOR_MAP.W;
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
  }

  /**
   * Get raw RGB array for a color letter.
   */
  function colorRGB(letter) {
    return COLOR_MAP[letter] || COLOR_MAP.W;
  }

  /**
   * Draw a soft glowing dot representing a lighthouse seen from far away.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Canvas X
   * @param {number} y - Canvas Y
   * @param {string} color - Color letter (W, R, G, Y, B)
   * @param {number} intensity - 0.0 to 1.0
   * @param {number} baseRadius - Base radius in pixels (default 4)
   */
  function drawLighthouseGlow(ctx, x, y, color, intensity, baseRadius) {
    if (intensity <= 0.01) return;

    const r = (baseRadius || 4) * (0.6 + 0.4 * intensity);
    const rgb = colorRGB(color);
    const alpha = intensity;

    // Outer halo
    const outerRadius = r * 3;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, outerRadius);
    gradient.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.6 * alpha})`);
    gradient.addColorStop(0.3, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.2 * alpha})`);
    gradient.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
    ctx.fill();

    // Inner bright core
    const coreGradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    coreGradient.addColorStop(0, `rgba(255, 255, 255, ${0.9 * alpha})`);
    coreGradient.addColorStop(0.5, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.7 * alpha})`);
    coreGradient.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);

    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Draw a rotating cone of light (beam) emanating from the lighthouse.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Canvas X of the light source
   * @param {number} y - Canvas Y of the light source
   * @param {number} angle - Current rotation angle in radians
   * @param {number} rangePixels - Beam length in pixels
   * @param {string} color - Color letter
   * @param {number} intensity - 0.0 to 1.0
   */
  function drawLighthouseBeam(ctx, x, y, angle, rangePixels, color, intensity) {
    if (intensity <= 0.01) return;

    const rgb = colorRGB(color);
    const alpha = intensity;
    const halfSpread = (15 * Math.PI) / 180; // 15 degrees each side = 30 degree cone

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Beam cone
    const beamGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rangePixels);
    beamGradient.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.35 * alpha})`);
    beamGradient.addColorStop(0.3, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.12 * alpha})`);
    beamGradient.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);

    ctx.fillStyle = beamGradient;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, rangePixels, -halfSpread, halfSpread, false);
    ctx.closePath();
    ctx.fill();

    // Secondary softer wider beam for atmospheric scatter
    const scatterGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rangePixels * 0.7);
    scatterGradient.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.08 * alpha})`);
    scatterGradient.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);

    ctx.fillStyle = scatterGradient;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, rangePixels * 0.7, -halfSpread * 2, halfSpread * 2, false);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Always draw the point glow on top of the beam
    drawLighthouseGlow(ctx, x, y, color, intensity, 5);
  }

  /**
   * Draw colored sector wedges around a lighthouse showing its light coverage.
   * Each sector has a start/end bearing, color, and range.
   * Only drawn at zoom >= 8.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Canvas X of the lighthouse
   * @param {number} y - Canvas Y of the lighthouse
   * @param {Array} sectors - Array of sector objects with start, end, color, range
   * @param {number} zoom - Current map zoom level
   * @param {object} map - MapLibre map instance (unused but available)
   * @param {object} lh - The lighthouse data object (for fallback range)
   */
  function drawLighthouseSectors(ctx, x, y, sectors, zoom, map, lh) {
    if (!sectors || sectors.length === 0) return;

    sectors.forEach(sector => {
      if (sector.start === null || sector.end === null) return;

      const color = sector.color || 'white';
      const colorLetter = color === 'white' ? 'W'
        : color === 'red' ? 'R'
        : color === 'green' ? 'G'
        : color === 'yellow' ? 'Y'
        : 'W';
      const rgb = colorRGB(colorLetter);
      const range = sector.range || lh.range || 10;

      // Convert nautical mile range to pixels, capped for performance
      const rangePixels = Math.min(range * 10 * Math.pow(2, zoom - 10), 500);

      // Convert nautical bearings (clockwise from north) to canvas angles
      const startAngle = (sector.start - 90) * Math.PI / 180;
      const endAngle = (sector.end - 90) * Math.PI / 180;

      ctx.save();

      // Soft ambient sector glow — no hard boundary lines
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, rangePixels);
      gradient.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.08)`);
      gradient.addColorStop(0.5, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.04)`);
      gradient.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, rangePixels, startAngle, endAngle);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    });
  }

  // Public API
  return {
    drawLighthouseGlow,
    drawLighthouseBeam,
    drawLighthouseSectors,
    colorRGBA,
    colorRGB,
    COLOR_MAP,
  };
})();
