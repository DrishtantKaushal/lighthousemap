/**
 * tooltip.js
 * ----------
 * Manages the floating tooltip that appears when hovering over a lighthouse
 * on the map. Shows name, light characteristics, range, height, and position.
 */

const Tooltip = (() => {

  const el = document.getElementById('tooltip');
  let isVisible = false;

  // Color display names
  const COLOR_NAMES = {
    W: 'White',
    R: 'Red',
    G: 'Green',
    Y: 'Yellow',
    B: 'Blue',
  };

  // Color CSS values for the indicator dot
  const COLOR_CSS = {
    W: '#fffcdc',
    R: '#ff3c3c',
    G: '#3cff3c',
    Y: '#ffff3c',
    B: '#3c78ff',
  };

  /**
   * Show the tooltip with lighthouse data near the given screen coordinates.
   *
   * @param {object} lighthouse - The lighthouse data object
   * @param {number} screenX - Mouse X on screen
   * @param {number} screenY - Mouse Y on screen
   */
  function show(lighthouse, screenX, screenY) {
    const name = lighthouse.name || 'Unnamed Light';
    const characteristic = lighthouse.character || 'F W';
    const range = lighthouse.range;
    const height = lighthouse.height;
    const lat = lighthouse.lat;
    const lon = lighthouse.lon;
    const primaryColor = lighthouse.colors ? lighthouse.colors[0] : 'W';
    const colorCSS = COLOR_CSS[primaryColor] || COLOR_CSS.W;
    const colorName = COLOR_NAMES[primaryColor] || 'White';

    // Build tooltip content
    let html = '';

    // Name with color dot
    html += `<div class="tooltip-name">`;
    html += `<span class="tooltip-color-dot" style="color: ${colorCSS}; background: ${colorCSS};"></span>`;
    html += `${escapeHTML(name)}`;
    html += `</div>`;

    // Light characteristic
    if (characteristic) {
      html += `<div class="tooltip-characteristic">${escapeHTML(characteristic)}</div>`;
    }

    // Details
    html += `<div class="tooltip-detail">`;
    if (range != null) {
      html += `<span>Range: ${range} nm</span>`;
    }
    if (height != null) {
      html += `<span>Height: ${height} m</span>`;
    }
    if (lat != null && lon != null) {
      html += `<span>${formatCoord(lat, lon)}</span>`;
    }
    html += `</div>`;

    el.innerHTML = html;

    // Position tooltip with offset from cursor
    positionTooltip(screenX, screenY);

    // Show
    el.classList.remove('hidden');
    isVisible = true;
  }

  /**
   * Hide the tooltip.
   */
  function hide() {
    if (!isVisible) return;
    el.classList.add('hidden');
    isVisible = false;
  }

  /**
   * Move the tooltip to stay near the cursor while keeping it within the viewport.
   */
  function positionTooltip(screenX, screenY) {
    const offsetX = 16;
    const offsetY = 16;
    const padding = 12;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Temporarily make visible to measure
    el.style.left = '0px';
    el.style.top = '0px';
    const rect = el.getBoundingClientRect();
    const tw = rect.width;
    const th = rect.height;

    let left = screenX + offsetX;
    let top = screenY + offsetY;

    // Keep within viewport
    if (left + tw + padding > vw) {
      left = screenX - tw - offsetX;
    }
    if (top + th + padding > vh) {
      top = screenY - th - offsetY;
    }
    if (left < padding) left = padding;
    if (top < padding) top = padding;

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  /**
   * Format latitude/longitude into a human-readable string.
   */
  function formatCoord(lat, lon) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(4)}\u00B0${latDir}, ${Math.abs(lon).toFixed(4)}\u00B0${lonDir}`;
  }

  /**
   * Escape HTML to prevent XSS from lighthouse names.
   */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { show, hide };
})();
