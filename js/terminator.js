/**
 * terminator.js
 * -------------
 * Calculates the real-time day/night terminator line based on UTC time.
 * Generates a GeoJSON polygon covering the night side of Earth, suitable
 * for rendering as a semi-transparent overlay on the map.
 *
 * The math: compute solar declination from day-of-year, hour angle from
 * UTC time, then trace the terminator as latitude = f(longitude).
 */

const Terminator = (() => {

  /**
   * Compute the sun's approximate position (declination and hour angle)
   * for a given Date object.
   *
   * @param {Date} date
   * @returns {{ declination: number, hourAngle: number }} in degrees
   */
  function getSunPosition(date) {
    // Day of year (1-based)
    const start = new Date(date.getFullYear(), 0, 0);
    const day = (date - start) / 86400000;

    // Solar declination: approximation using the obliquity of the ecliptic
    // -23.44 degrees * cos(2pi/365 * (day + 10))
    // The +10 offset accounts for the winter solstice being ~Dec 21 (day 355)
    const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10));

    // Hour angle: how far the sun has moved from the anti-meridian
    // At 00:00 UTC the sun is at 180W; it moves 360 degrees per day
    const minutesUTC = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    const hourAngle = (minutesUTC / 1440 * 360) - 180;

    return { declination, hourAngle };
  }

  /**
   * Generate a GeoJSON Feature (Polygon) covering the night side of Earth.
   *
   * @param {Date} [date] - Defaults to current time
   * @returns {object} GeoJSON Feature with a Polygon geometry
   */
  function generateTerminatorGeoJSON(date) {
    const { declination, hourAngle } = getSunPosition(date || new Date());
    const decRad = declination * Math.PI / 180;
    const points = [];

    // Trace the terminator line from -180 to +180 longitude
    for (let lon = -180; lon <= 180; lon += 1) {
      const lonRad = (lon - hourAngle) * Math.PI / 180;
      // Latitude of the terminator at this longitude:
      // lat = atan(-cos(lonRad) / tan(decRad))
      const lat = Math.atan(-Math.cos(lonRad) / Math.tan(decRad)) * 180 / Math.PI;
      points.push([lon, lat]);
    }

    // Close the polygon by extending to cover the dark side.
    // When the sun is in the northern hemisphere (declination >= 0),
    // darkness is predominantly south of the terminator line, so we
    // extend to -90. Otherwise we extend to +90.
    const nightSide = declination >= 0 ? -90 : 90;
    const polygon = [...points];
    polygon.push([180, nightSide]);
    polygon.push([-180, nightSide]);
    polygon.push(points[0]); // close the ring

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [polygon]
      }
    };
  }

  /**
   * Check if a given lat/lon coordinate is on the night side.
   *
   * @param {number} lat - Latitude in degrees
   * @param {number} lon - Longitude in degrees
   * @param {Date} [date] - Defaults to current time
   * @returns {boolean} true if the point is in darkness
   */
  function isNight(lat, lon, date) {
    const { declination, hourAngle } = getSunPosition(date || new Date());
    const decRad = declination * Math.PI / 180;
    const lonRad = (lon - hourAngle) * Math.PI / 180;

    // Terminator latitude at this longitude
    const terminatorLat = Math.atan(-Math.cos(lonRad) / Math.tan(decRad)) * 180 / Math.PI;

    // If sun is in northern hemisphere, night is south of terminator
    if (declination >= 0) {
      return lat < terminatorLat;
    } else {
      return lat > terminatorLat;
    }
  }

  // Public API
  return { getSunPosition, generateTerminatorGeoJSON, isNight };
})();
