/**
 * search.js
 * ---------
 * Search and filter panel for the Lighthouse Map.
 * Provides substring search with debounce, result dropdown with fly-to,
 * and color filter chips that toggle which light colors are rendered.
 */

const Search = (() => {

  let lighthouses = [];
  let map = null;
  let searchIndex = [];      // pre-built lowercase name index: { index, nameLower }
  let debounceTimer = null;
  const DEBOUNCE_MS = 300;
  const MAX_RESULTS = 8;

  // Color display info for search results
  const COLOR_CSS = {
    W: '#fffcdc',
    R: '#ff3c3c',
    G: '#3cff3c',
    Y: '#ffff3c',
    B: '#3c78ff',
  };

  /**
   * Initialize the search system after lighthouse data is loaded.
   *
   * @param {Array} lhData - The lighthouses array
   * @param {object} mapInstance - The MapLibre map instance
   */
  function init(lhData, mapInstance) {
    lighthouses = lhData;
    map = mapInstance;

    // Build search index (only named lighthouses)
    searchIndex = [];
    for (let i = 0; i < lighthouses.length; i++) {
      const name = lighthouses[i].name;
      if (name) {
        searchIndex.push({
          index: i,
          nameLower: name.toLowerCase(),
          name: name,
        });
      }
    }

    console.log(`Search index: ${searchIndex.length} named lighthouses`);

    // Wire up DOM events
    const input = document.getElementById('search-input');
    const resultsEl = document.getElementById('search-results');

    if (!input || !resultsEl) return;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        performSearch(input.value.trim());
      }, DEBOUNCE_MS);
    });

    input.addEventListener('focus', () => {
      if (input.value.trim().length > 0) {
        performSearch(input.value.trim());
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#search-panel')) {
        resultsEl.classList.add('hidden');
      }
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => {
      const items = resultsEl.querySelectorAll('.search-result-item');
      if (items.length === 0) return;

      let activeIdx = -1;
      items.forEach((item, idx) => {
        if (item.classList.contains('active')) activeIdx = idx;
      });

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(activeIdx + 1, items.length - 1);
        items.forEach(it => it.classList.remove('active'));
        items[next].classList.add('active');
        items[next].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(activeIdx - 1, 0);
        items.forEach(it => it.classList.remove('active'));
        items[prev].classList.add('active');
        items[prev].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeIdx >= 0) {
          items[activeIdx].click();
        } else if (items.length > 0) {
          items[0].click();
        }
      } else if (e.key === 'Escape') {
        resultsEl.classList.add('hidden');
        input.blur();
      }
    });

    // Wire up filter chips
    const filterChips = document.querySelectorAll('.filter-chip');
    filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const filter = chip.dataset.filter;

        // Toggle: if clicking active non-all chip, reset to all
        if (chip.classList.contains('active') && filter !== 'all') {
          filterChips.forEach(c => c.classList.remove('active'));
          document.querySelector('.filter-chip[data-filter="all"]').classList.add('active');
          window.LighthouseMap.setColorFilter('all');
        } else {
          filterChips.forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          window.LighthouseMap.setColorFilter(filter);
        }
      });
    });
  }

  /**
   * Perform a substring search and display results.
   *
   * @param {string} query - The search query
   */
  function performSearch(query) {
    const resultsEl = document.getElementById('search-results');
    if (!resultsEl) return;

    if (query.length < 2) {
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      return;
    }

    const queryLower = query.toLowerCase();
    const matches = [];

    // Prioritize prefix matches, then substring matches
    for (let i = 0; i < searchIndex.length && matches.length < MAX_RESULTS * 2; i++) {
      const entry = searchIndex[i];
      if (entry.nameLower.startsWith(queryLower)) {
        matches.push({ ...entry, priority: 0 });
      }
    }

    if (matches.length < MAX_RESULTS) {
      for (let i = 0; i < searchIndex.length && matches.length < MAX_RESULTS * 2; i++) {
        const entry = searchIndex[i];
        if (!entry.nameLower.startsWith(queryLower) && entry.nameLower.includes(queryLower)) {
          matches.push({ ...entry, priority: 1 });
        }
      }
    }

    // Sort: prefix matches first, then by name length (shorter = more relevant)
    matches.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.name.length - b.name.length;
    });

    const topResults = matches.slice(0, MAX_RESULTS);

    if (topResults.length === 0) {
      resultsEl.innerHTML = '<div class="search-no-results">No lighthouses found</div>';
      resultsEl.classList.remove('hidden');
      return;
    }

    resultsEl.innerHTML = topResults.map((match, idx) => {
      const lh = lighthouses[match.index];
      const primaryColor = lh.colors ? lh.colors[0] : 'W';
      const colorLetter = typeof primaryColor === 'string' && primaryColor.length > 1
        ? (primaryColor === 'white' ? 'W' : primaryColor === 'red' ? 'R' : primaryColor === 'green' ? 'G' : primaryColor === 'yellow' ? 'Y' : 'W')
        : (primaryColor || 'W');
      const dotColor = COLOR_CSS[colorLetter] || COLOR_CSS.W;
      const characteristic = lh.character || '';
      const highlightedName = highlightMatch(match.name, query);

      return `<div class="search-result-item${idx === 0 ? ' active' : ''}" data-index="${match.index}">
        <span class="search-result-dot" style="background: ${dotColor}; box-shadow: 0 0 6px ${dotColor};"></span>
        <div class="search-result-text">
          <div class="search-result-name">${highlightedName}</div>
          ${characteristic ? `<div class="search-result-char">${escapeHTML(characteristic)}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    resultsEl.classList.remove('hidden');

    // Wire up click handlers for results
    resultsEl.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index, 10);
        flyToLighthouse(idx);
        resultsEl.classList.add('hidden');
      });
    });
  }

  /**
   * Highlight the matching portion of a name.
   */
  function highlightMatch(name, query) {
    const idx = name.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHTML(name);
    const before = escapeHTML(name.slice(0, idx));
    const match = escapeHTML(name.slice(idx, idx + query.length));
    const after = escapeHTML(name.slice(idx + query.length));
    return `${before}<mark>${match}</mark>${after}`;
  }

  /**
   * Fly the map to a lighthouse and highlight it.
   *
   * @param {number} index - Index into the lighthouses array
   */
  function flyToLighthouse(index) {
    const lh = lighthouses[index];
    if (!lh) return;

    // Set the highlight
    window.LighthouseMap.setHighlightedIndex(index);

    // Fly to the lighthouse
    map.flyTo({
      center: [lh.lon, lh.lat],
      zoom: Math.max(map.getZoom(), 10),
      duration: 1500,
      essential: true,
    });

    // Clear highlight after 8 seconds
    setTimeout(() => {
      if (window.LighthouseMap.getHighlightedIndex() === index) {
        window.LighthouseMap.setHighlightedIndex(-1);
      }
    }, 8000);
  }

  /**
   * Escape HTML to prevent XSS.
   */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Public API
  return { init };
})();
