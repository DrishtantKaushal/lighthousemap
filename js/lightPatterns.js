/**
 * lightPatterns.js
 * ----------------
 * Parses lighthouse light-character strings and produces a time-varying
 * intensity value (0.0 - 1.0) that faithfully reproduces the real flash
 * pattern of each aid to navigation.
 *
 * Supported patterns:
 *   F        Fixed (always on)
 *   Fl       Flashing (~10% duty cycle)
 *   LFl      Long Flashing (~20% duty cycle)
 *   Iso      Isophase (equal light / dark)
 *   Oc       Occulting (mostly light, brief eclipse)
 *   Q        Quick flashing (60/min = 1 Hz)
 *   VQ       Very Quick flashing (120/min = 2 Hz)
 *   Mo(A)    Morse code character
 *   Al.WR    Alternating colors
 *   Fl(2)    Group flashing (N flashes per period)
 *   Gp.Fl(2) Group flashing alternate notation
 */

const LightPatterns = (() => {

  // Morse code lookup (dot = 1 unit, dash = 3 units, inter-element gap = 1 unit)
  const MORSE = {
    A: '.-',    B: '-...',  C: '-.-.',  D: '-..',
    E: '.',     F: '..-.',  G: '--.',   H: '....',
    I: '..',    J: '.---',  K: '-.-',   L: '.-..',
    M: '--',    N: '-.',    O: '---',   P: '.--.',
    Q: '--.-',  R: '.-.',   S: '...',   T: '-',
    U: '..-',   V: '...-',  W: '.--',   X: '-..-',
    Y: '-.--',  Z: '--..',
  };

  /**
   * Parse a light-character string into a descriptor object.
   * Examples:
   *   "Fl W 5s"       -> { type:'Fl', group:1, period:5, colors:['W'] }
   *   "Fl(3) R 15s"   -> { type:'Fl', group:3, period:15, colors:['R'] }
   *   "Iso WRG 6s"    -> { type:'Iso', group:1, period:6, colors:['W','R','G'] }
   *   "Al.WR 10s"     -> { type:'Al', group:1, period:10, colors:['W','R'] }
   *   "Mo(A) W 8s"    -> { type:'Mo', morseChar:'A', period:8, colors:['W'] }
   *   "Q(6)+LFl 15s"  -> { type:'Fl', group:6, period:15, colors:['W'] }
   */
  function parse(raw) {
    if (!raw || typeof raw !== 'string') {
      return { type: 'F', group: 1, period: 5, colors: ['W'], morseChar: null };
    }

    const s = raw.trim();
    let type = 'F';
    let group = 1;
    let period = 5;
    let colors = ['W'];
    let morseChar = null;

    // Extract period (number followed by 's')
    const periodMatch = s.match(/([\d.]+)\s*s/i);
    if (periodMatch) {
      period = parseFloat(periodMatch[1]) || 5;
    }

    // Extract colors (single uppercase letters that are W, R, G, Y, Bu)
    const colorMatch = s.match(/\b([WRGYB][WRGYB]*u?)\b/);
    if (colorMatch) {
      const colorStr = colorMatch[1].replace('Bu', 'B');
      colors = colorStr.split('').filter(c => 'WRGYB'.includes(c));
      if (colors.length === 0) colors = ['W'];
    }

    // Determine type
    if (/^Al\b/i.test(s) || /\bAl\./i.test(s)) {
      type = 'Al';
      // Parse alternating colors from "Al.WR" style
      const alMatch = s.match(/Al\.?([A-Z]+)/i);
      if (alMatch) {
        colors = alMatch[1].split('').filter(c => 'WRGYB'.includes(c));
      }
    } else if (/\bMo\s*\((\w)\)/i.test(s)) {
      type = 'Mo';
      morseChar = RegExp.$1.toUpperCase();
    } else if (/\bVQ\b/i.test(s)) {
      type = 'VQ';
      period = period || 0.5;
    } else if (/\bQ\b/i.test(s) && !/\bFl/i.test(s)) {
      type = 'Q';
      period = period || 1;
    } else if (/\bLFl\b/i.test(s)) {
      type = 'LFl';
    } else if (/\bFl\b/i.test(s) || /\bGp\.?Fl/i.test(s)) {
      type = 'Fl';
    } else if (/\bIso\b/i.test(s)) {
      type = 'Iso';
    } else if (/\bOc\b/i.test(s)) {
      type = 'Oc';
    } else if (/\bF\b/.test(s) && s.length < 10) {
      type = 'F';
    }

    // Extract group count: Fl(2), Oc(3), Q(6), Gp.Fl(2+1) etc.
    const groupMatch = s.match(/(?:Fl|Oc|Q|VQ|LFl|Gp\.?Fl)\s*\((\d+)/i);
    if (groupMatch) {
      group = parseInt(groupMatch[1], 10) || 1;
    }

    return { type, group, period, colors, morseChar };
  }

  /**
   * Compute instantaneous intensity for a given pattern descriptor and timestamp.
   *
   * @param {object} desc - Parsed pattern descriptor from parse()
   * @param {number} timestamp - Current time in seconds (performance.now() / 1000)
   * @returns {{ intensity: number, colorIndex: number }}
   */
  function getIntensity(desc, timestamp) {
    const { type, group, period, colors, morseChar } = desc;
    const t = ((timestamp % period) + period) % period; // normalized time within period
    const phase = t / period; // 0..1

    let intensity = 0;
    let colorIndex = 0;

    switch (type) {

      case 'F': // Fixed - always on
        intensity = 1.0;
        break;

      case 'Fl': { // Flashing
        if (group <= 1) {
          // Single flash: 10% duty cycle
          intensity = phase < 0.1 ? 1.0 : 0.0;
        } else {
          // Group flashing: N short flashes evenly spaced in first 60% of period
          const flashWindow = 0.6;
          const flashDuty = 0.08;
          if (phase < flashWindow) {
            const groupPhase = (phase / flashWindow) * group;
            const withinFlash = groupPhase % 1.0;
            intensity = withinFlash < flashDuty / (flashWindow / group) ? 1.0 : 0.0;
            // Simpler: divide the flash window into group slots
            const slotDuration = flashWindow / group;
            const slotPhase = (phase % slotDuration) / slotDuration;
            intensity = slotPhase < 0.25 ? 1.0 : 0.0;
          } else {
            intensity = 0.0;
          }
        }
        break;
      }

      case 'LFl': { // Long Flashing (20% duty)
        if (group <= 1) {
          intensity = phase < 0.2 ? 1.0 : 0.0;
        } else {
          const flashWindow = 0.7;
          if (phase < flashWindow) {
            const slotDuration = flashWindow / group;
            const slotPhase = (phase % slotDuration) / slotDuration;
            intensity = slotPhase < 0.35 ? 1.0 : 0.0;
          } else {
            intensity = 0.0;
          }
        }
        break;
      }

      case 'Iso': // Isophase - equal light and dark
        intensity = phase < 0.5 ? 1.0 : 0.0;
        break;

      case 'Oc': { // Occulting - mostly on, brief eclipse
        if (group <= 1) {
          intensity = phase < 0.75 ? 1.0 : 0.0;
        } else {
          const darkWindow = 0.4;
          const darkStart = 1.0 - darkWindow;
          if (phase < darkStart) {
            intensity = 1.0;
          } else {
            const darkPhase = (phase - darkStart) / darkWindow;
            const slotDuration = 1.0 / group;
            const slotPhase = (darkPhase % slotDuration) / slotDuration;
            intensity = slotPhase < 0.5 ? 0.0 : 1.0;
          }
        }
        break;
      }

      case 'Q': { // Quick - 60 flashes/min = 1 Hz within period
        const qFreq = 1.0; // 1 Hz
        const qPhase = (timestamp * qFreq) % 1.0;
        intensity = qPhase < 0.3 ? 1.0 : 0.0;
        break;
      }

      case 'VQ': { // Very Quick - 120 flashes/min = 2 Hz
        const vqFreq = 2.0;
        const vqPhase = (timestamp * vqFreq) % 1.0;
        intensity = vqPhase < 0.3 ? 1.0 : 0.0;
        break;
      }

      case 'Mo': { // Morse code
        const code = MORSE[morseChar] || '.-';
        // Total units: dots=1, dashes=3, inter-element=1, total + word space
        let totalUnits = 0;
        for (let i = 0; i < code.length; i++) {
          totalUnits += code[i] === '.' ? 1 : 3;
          if (i < code.length - 1) totalUnits += 1; // inter-element gap
        }
        totalUnits += 3; // word space at end

        const unitDuration = period / totalUnits;
        const tInPeriod = t;
        let elapsed = 0;
        intensity = 0.0;
        for (let i = 0; i < code.length; i++) {
          const elemDuration = (code[i] === '.' ? 1 : 3) * unitDuration;
          if (tInPeriod >= elapsed && tInPeriod < elapsed + elemDuration) {
            intensity = 1.0;
            break;
          }
          elapsed += elemDuration;
          // inter-element gap
          elapsed += unitDuration;
        }
        break;
      }

      case 'Al': { // Alternating
        // Alternate between colors each half-period
        if (colors.length >= 2) {
          const segments = colors.length;
          const segPhase = Math.floor(phase * segments) % segments;
          colorIndex = segPhase;
          // Brief dark gap between alternations
          const segInner = (phase * segments) % 1.0;
          intensity = segInner < 0.9 ? 1.0 : 0.0;
        } else {
          intensity = 1.0;
        }
        break;
      }

      default:
        intensity = 1.0;
    }

    // Apply soft edges (slight ramp up/down for realism)
    // Skipped for performance - hard transitions look fine with additive blending

    return { intensity, colorIndex };
  }

  // Public API
  return { parse, getIntensity };
})();
