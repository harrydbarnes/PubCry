'use strict';

/**
 * FogOfWar – Custom Leaflet layer that draws a full-viewport dark smoke
 * canvas and "punches" clear radial-gradient holes for discovered areas.
 *
 * Usage:
 *   const fog = L.fogOfWar({ fogColor: 'rgba(12,8,2,0.90)' }).addTo(map);
 *   fog.reveal({ lat: 51.51, lng: -0.12 }, 400);          // instant
 *   fog.revealAnimated({ lat: 51.51, lng: -0.12 }, 400);  // animated burn
 */

/* global L */

L.FogOfWar = L.Layer.extend({

  options: {
    /** CSS-style rgba fill for the fog */
    fogColor: 'rgba(12,8,2,0.90)',
    /** Pane z-index (above tile layers, below markers at 400+) */
    paneZIndex: 450
  },

  initialize: function (options) {
    L.setOptions(this, options);
    /** @type {Array<{latlng: L.LatLng, radius: number}>} */
    this._revealedAreas = [];
  },

  // ── Leaflet lifecycle ──────────────────────────────────────────────────────

  onAdd: function (map) {
    this._map = map;

    if (!map.getPane('fog')) {
      const pane = map.createPane('fog');
      pane.style.zIndex = String(this.options.paneZIndex);
      pane.style.pointerEvents = 'none';
    }

    this._canvas = document.createElement('canvas');
    this._canvas.className = 'fog-canvas';
    this._canvas.style.position = 'absolute';
    this._canvas.style.top = '0';
    this._canvas.style.left = '0';
    this._canvas.style.pointerEvents = 'none';
    map.getPane('fog').appendChild(this._canvas);

    map.on('viewreset move zoom resize', this._reset, this);

    if (map.options.zoomAnimation && L.Browser.any3d) {
      map.on('zoomanim', this._onZoomAnim, this);
    }

    this._reset();
  },

  onRemove: function (map) {
    map.getPane('fog').removeChild(this._canvas);
    map.off('viewreset move zoom resize', this._reset, this);
    if (map.options.zoomAnimation && L.Browser.any3d) {
      map.off('zoomanim', this._onZoomAnim, this);
    }
    this._map = null;
  },

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Instantly reveal a circular area.
   * @param {L.LatLng|{lat:number,lng:number}} latlng
   * @param {number} radiusMetres
   * @param {number} opacity
   */
  reveal: function (latlng, radiusMetres, opacity = 1) {
    this._revealedAreas.push({
      latlng: L.latLng(latlng),
      radius: radiusMetres,
      opacity: opacity
    });
    this._draw();
  },

  /**
   * Animated reveal – fog "burns away" over ~600 ms.
   * @param {L.LatLng|{lat:number,lng:number}} latlng
   * @param {number} radiusMetres
   * @param {number} opacity
   */
  revealAnimated: function (latlng, radiusMetres, opacity = 1) {
    const targetRadius = radiusMetres;
    let currentRadius = 0;
    const steps = 40;
    const increment = targetRadius / steps;

    const areaEntry = { latlng: L.latLng(latlng), radius: 0, opacity: opacity };
    this._revealedAreas.push(areaEntry);

    const tick = () => {
      currentRadius = Math.min(currentRadius + increment, targetRadius);
      areaEntry.radius = currentRadius;
      this._draw();
      if (currentRadius < targetRadius) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  },

  // ── Internal ───────────────────────────────────────────────────────────────

  _reset: function () {
    const map = this._map;
    if (!map) return;

    const size = map.getSize();
    this._canvas.width  = size.x;
    this._canvas.height = size.y;

    // Position canvas so (0,0) aligns with the map container's top-left
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);

    this._draw();
  },

  _onZoomAnim: function (e) {
    const scale  = this._map.getZoomScale(e.zoom);
    const offset = this._map._latLngBoundsToNewLayerBounds(
      this._map.getBounds(), e.zoom, e.center
    ).min;
    L.DomUtil.setTransform(this._canvas, offset, scale);
  },

  _draw: function () {
    const map    = this._map;
    const canvas = this._canvas;
    if (!map || !canvas.width) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── 1. Fill the entire canvas with dark fog ──────────────────────────────
    ctx.fillStyle = this.options.fogColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ── 2. Apply a subtle noise-like variation for "smoke" texture ────────────
    this._drawSmokeNoise(ctx, canvas.width, canvas.height);

    // ── 3. Punch clear holes for each revealed area ──────────────────────────
    ctx.globalCompositeOperation = 'destination-out';

    for (const area of this._revealedAreas) {
      if (area.radius <= 0) continue;
      const pt  = map.latLngToContainerPoint(area.latlng);
      const rpx = this._metersToPixels(area.radius, area.latlng.lat);
      const op  = area.opacity !== undefined ? area.opacity : 1;

      // Smooth gradient so the fog edge looks like drifting smoke
      const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, rpx);
      grad.addColorStop(0,    `rgba(0,0,0,${op})`);
      grad.addColorStop(0.55, `rgba(0,0,0,${0.97 * op})`);
      grad.addColorStop(0.78, `rgba(0,0,0,${0.7 * op})`);
      grad.addColorStop(0.90, `rgba(0,0,0,${0.3 * op})`);
      grad.addColorStop(1,    'rgba(0,0,0,0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, rpx, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  },

  /**
   * Draw sparse semi-transparent dark blobs to give the fog a
   * slightly cloudy / smoky uneven look.  Seeded so it is stable
   * between redraws – only changes when the canvas size changes.
   */
  _drawSmokeNoise: function (ctx, w, h) {
    ctx.globalCompositeOperation = 'source-over';
    const seed = Math.floor(w / 10) * 31 + Math.floor(h / 10);
    const rng  = this._seededRng(seed);

    const blobs = 18;
    for (let i = 0; i < blobs; i++) {
      const x  = rng() * w;
      const y  = rng() * h;
      const r  = 40 + rng() * 120;
      const a  = 0.04 + rng() * 0.08;

      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0,   `rgba(30,20,5,${a})`);
      g.addColorStop(1,   'rgba(0,0,0,0)');

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  /** Simple seeded pseudo-random number generator (mulberry32). */
  _seededRng: function (seed) {
    let s = seed >>> 0;
    return function () {
      s  += 0x6D2B79F5;
      let t = s;
      t  = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  /**
   * Convert a real-world radius in metres to canvas pixels at the
   * current map zoom and latitude.
   * @param {number} metres
   * @param {number} lat  – latitude in degrees
   * @returns {number} pixel radius
   */
  _metersToPixels: function (metres, lat) {
    const zoom = this._map.getZoom();
    // Metres per pixel at this zoom and latitude (Web Mercator formula)
    const mpp = (40075016.686 * Math.abs(Math.cos(lat * Math.PI / 180))) /
                Math.pow(2, zoom + 8);
    return metres / mpp;
  }
});

/** Factory helper so callers can write  L.fogOfWar(options) */
L.fogOfWar = function (options) {
  return new L.FogOfWar(options);
};
