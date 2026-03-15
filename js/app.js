'use strict';

/* global L, PUB_DATA, TUBE_DATA */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Metres within which a location is considered "nearby" */
const PROXIMITY_METRES   = 150;

/** Keywords used by the AI model to identify pub-related images */
const AI_PUB_KEYWORDS  = ["beer", "glass", "cup", "goblet", "mug", "ale", "lager", "pint"];
/** Keywords used by OCR to validate receipt text against pub context */
const OCR_PUB_KEYWORDS = ["pint", "ale", "lager", "pub", "bar", "drinks", "draught"];
/** Milliseconds the user must dwell to discover a location (real mode) */
const REQUIRED_MS_REAL   = 15 * 60 * 1000;
/** Milliseconds for demo mode */
const REQUIRED_MS_DEMO   = 5 * 1000;
/** Storage key for persisted state */
const STORAGE_KEY        = 'pubcry-v1';

// ── PubCryApp ─────────────────────────────────────────────────────────────────

class PubCryApp {

  constructor () {
    /** @type {L.Map} */               this.map           = null;
    /** @type {L.FogOfWar} */          this.fog           = null;
    /** @type {L.Marker|null} */       this.userMarker    = null;
    /** @type {{lat:number,lng:number}|null} */ this.pos  = null;
    /** @type {Set<string>} */         this.discovered    = new Set();
    /** @type {Object.<string,{accumulated:number,location:Object}>} */
    this.timers = {};
    /** @type {boolean} */             this.demoMode      = false;
    /** @type {number|null} */         this.watchId       = null;
    /** @type {number|null} */         this.tickId        = null;
    /** @type {string|null} */         this.activeTimerId = null;
    /** @type {Promise<object>|null} */  this._mobilenetModel = null;
    /** @type {Promise<object>|null} */  this._tesseractWorkerPromise = null;

    this._loadState();
    this._initMap();
    this._initFog();
    this._initMarkers();
    this._bindUI();
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  _loadState () {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        this.discovered = new Set(state.discovered || []);
      }
    } catch (_) { /* ignore */ }
  }

  _saveState () {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        discovered: [...this.discovered]
      }));
    } catch (_) { /* ignore */ }
  }

  // ── Map init ─────────────────────────────────────────────────────────────────

  _initMap () {
    this.map = L.map('map', {
      center: [51.5145, -0.1079],
      zoom:   14,
      zoomControl: false,
      attributionControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains:  'abcd',
      maxZoom:      19
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // Create a pane above fog for markers so they always show through the smoke
    const markerPane = this.map.createPane('markerPane');
    markerPane.style.zIndex = '500';
  }

  // ── Fog init ─────────────────────────────────────────────────────────────────

  _initFog () {
    this.fog = L.fogOfWar().addTo(this.map);

    // Re-apply any already-discovered areas from saved state
    for (const id of this.discovered) {
      const loc = this._findById(id);
      if (loc) this.fog.reveal({ lat: loc.lat, lng: loc.lng }, loc.revealRadius);
    }
  }

  // ── Markers ───────────────────────────────────────────────────────────────────

  _initMarkers () {
    this._markers = {};

    for (const pub of PUB_DATA)   this._addMarker(pub,  'pub');
    for (const tube of TUBE_DATA) this._addMarker(tube, 'tube');

    this._updateAllMarkers();
  }

  _addMarker (location, type) {
    const marker = L.marker([location.lat, location.lng], {
      icon:  this._buildIcon(location.id, type),
      pane: 'markerPane',
      title: location.name
    });

    marker.bindPopup(this._buildPopup(location, type), {
      className:   'farcry-popup',
      maxWidth:    220,
      closeButton: true
    });

    marker.addTo(this.map);
    this._markers[location.id] = { marker, location, type };
  }

  _buildIcon (id, type) {
    const isFound  = this.discovered.has(id);
    const classes  = [
      'map-marker',
      type === 'pub' ? 'pub-marker' : 'tube-marker',
      isFound ? 'discovered' : ''
    ].join(' ');
    const emoji = type === 'pub' ? '🍺' : '🚇';
    return L.divIcon({ className: classes, html: `<span>${emoji}</span>`, iconSize: [36,36], iconAnchor: [18,18] });
  }

  _buildPopup (location, type) {
    const found  = this.discovered.has(location.id);
    const status = found ? 'DISCOVERED' : 'UNDISCOVERED';
    const cls    = found ? 'status-discovered' : 'status-unknown';
    return `<div class="popup-content">
      <div class="popup-icon">${type === 'pub' ? '🍺' : '🚇'}</div>
      <h3 class="popup-name">${location.name}</h3>
      <div class="popup-status ${cls}">${status}</div>
      ${location.description ? `<p class="popup-desc">${location.description}</p>` : ''}
      ${!found ? '<p class="popup-hint">Stay nearby for ${minutes} to reveal this area</p>' : ''}
    </div>`.replace('${minutes}', this.demoMode ? '5 seconds' : '15 minutes');
  }

  _updateAllMarkers () {
    for (const id of Object.keys(this._markers)) {
      const { marker, type } = this._markers[id];
      marker.setIcon(this._buildIcon(id, type));
    }
  }

  _markNearby (locationId, active) {
    const entry = this._markers[locationId];
    if (!entry) return;
    const { marker, type } = entry;
    const classes = [
      'map-marker',
      type === 'pub' ? 'pub-marker' : 'tube-marker',
      this.discovered.has(locationId) ? 'discovered' : '',
      active ? 'nearby' : ''
    ].join(' ');
    const emoji = type === 'pub' ? '🍺' : '🚇';
    marker.setIcon(L.divIcon({ className: classes, html: `<span>${emoji}</span>`, iconSize: [36,36], iconAnchor: [18,18] }));
  }

  // ── UI bindings ───────────────────────────────────────────────────────────────

  _bindUI () {
    document.getElementById('start-real-btn').addEventListener('click', () => {
      this.demoMode = false;
      this._dismissWelcome();
      this._startRealLocation();
    });

    document.getElementById('start-demo-btn').addEventListener('click', () => {
      this.demoMode = true;
      this._dismissWelcome();
      this._startDemoMode();
    });

    document.getElementById('locate-btn').addEventListener('click', () => {
      if (this.pos) this.map.setView([this.pos.lat, this.pos.lng], 15, { animate: true });
    });

    document.getElementById('reset-btn').addEventListener('click', () => this._showResetModal());

    const verifyBtn = document.getElementById('verify-btn');
    const verifyInput = document.getElementById('verify-image-input');

    if (verifyBtn && verifyInput) {
      verifyBtn.addEventListener('click', () => verifyInput.click());
      verifyInput.addEventListener('change', (e) => this._handleImageVerification(e));
    }
  }

  // ── Image Verification ────────────────────────────────────────────────────────

  _setVerificationStatus(message, duration = 0) {
    const statusEl = document.getElementById('verification-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.remove('hidden');
    if (duration > 0) {
      setTimeout(() => statusEl.classList.add('hidden'), duration);
    }
  }

  async _handleImageVerification(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Show loading status
    this._setVerificationStatus('Verifying...');
    const verifyBtn = document.getElementById('verify-btn');

    if (verifyBtn) verifyBtn.classList.add('hidden');

    let objectUrl = null;
    try {
      // Load image
      const image = new Image();
      const imageLoadPromise = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
      objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
      await imageLoadPromise;

      // Pass to verification logic
      await this._verifyImage(image);
    } catch (err) {
      console.error("Verification failed:", err);
      this._setVerificationStatus('Verification failed. Try again.', 3000);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Reset input so the same file can be selected again
      event.target.value = '';
      if (verifyBtn) verifyBtn.classList.remove('hidden');
    }
  }

  async _verifyImage(image) {
    const locationId = this.activeTimerId;
    if (!locationId) return;

    const loc = this._findById(locationId);

    try {
      this._setVerificationStatus('Scanning image with AI...');

      const isPubOrPint = await this._verifyWithAI(image);

      if (isPubOrPint) {
        this._setVerificationStatus('AI Verification Passed!', 2000);
        this._discoverLocation(loc);
        return;
      }

      // Fallback to OCR if AI fails
      this._setVerificationStatus('Scanning receipt text...');
      const isReceipt = await this._verifyWithOCR(image, loc);

      if (isReceipt) {
        this._setVerificationStatus('Receipt Verification Passed!', 2000);
        this._discoverLocation(loc);
        return;
      }

      this._setVerificationStatus('Verification failed. Not a pint or receipt.', 3000);
    } catch (err) {
      console.error("Verification error:", err);
      this._setVerificationStatus('Verification error occurred.', 3000);
    }
  }

  async _verifyWithAI(image) {
    try {
      // Load model once and reuse across calls
      if (!this._mobilenetModel) {
        this._mobilenetModel = mobilenet.load();
      }
      const model = await this._mobilenetModel;
      const predictions = await model.classify(image);

      for (const prediction of predictions) {
        const className = prediction.className.toLowerCase();
        if (AI_PUB_KEYWORDS.some(keyword => className.includes(keyword))) {
          console.log(`AI matched keyword in class '${className}' (prob: ${prediction.probability})`);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("AI scanning error:", error);
      return false;
    }
  }

  async _verifyWithOCR(image, location) {
    try {
      // Create Tesseract worker once and reuse across calls
      if (!this._tesseractWorkerPromise) {
        this._tesseractWorkerPromise = Tesseract.createWorker('eng');
      }
      const worker = await this._tesseractWorkerPromise;
      const result = await worker.recognize(image);
      const text = result.data.text.toLowerCase();
      console.log("OCR Extracted Text:\n", text);

      // 1. Check for dates
      // Simple regex for common UK receipt dates: DD/MM/YY, DD/MM/YYYY, DD-MM-YY, etc.
      const dateRegex = /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/;
      const hasDate = dateRegex.test(text);

      // 2. Check for pub names, descriptions, or generic keywords
      const locName = location.name.toLowerCase();
      const locDesc = location.description ? location.description.toLowerCase() : '';

      const hasKeyword = text.includes(locName) ||
                         (locDesc && text.includes(locDesc)) ||
                         OCR_PUB_KEYWORDS.some(keyword => text.includes(keyword));

      return hasDate && hasKeyword;
    } catch (error) {
      console.error("OCR scanning error:", error);
      return false;
    }
  }

  _dismissWelcome () {
    document.getElementById('welcome-overlay').classList.add('hidden');
  }

  // ── Real geolocation ─────────────────────────────────────────────────────────

  _startRealLocation () {
    if (!navigator.geolocation) {
      this._showLocationStatus('Geolocation not supported by your browser.');
      return;
    }
    this._showLocationStatus('Acquiring GPS signal…');

    this.watchId = navigator.geolocation.watchPosition(
      pos  => this._onPosition(pos.coords.latitude, pos.coords.longitude),
      err  => this._onLocationError(err),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
    );
  }

  _onLocationError (err) {
    const msg = {
      1: 'Location permission denied. Enable location to play.',
      2: 'Location unavailable. Try again outdoors.',
      3: 'Location request timed out.'
    }[err.code] || 'Unknown location error.';
    this._showLocationStatus(msg);
  }

  // ── Demo mode ─────────────────────────────────────────────────────────────────

  _startDemoMode () {
    document.getElementById('demo-banner').classList.remove('hidden');
    // Seed user position in central London
    this._onPosition(51.5145, -0.1079);
    // Let the user click anywhere on the map to "teleport"
    this.map.on('click', e => {
      this._onPosition(e.latlng.lat, e.latlng.lng);
    });
  }

  // ── Position update (shared by real + demo) ───────────────────────────────────

  _onPosition (lat, lng) {
    this.pos = { lat, lng };
    this._hideLocationStatus();
    this._updateUserMarker(lat, lng);
    this._startTickIfNeeded();
  }

  _startTickIfNeeded () {
    if (this.tickId !== null) return;
    this.tickId = setInterval(() => this._tick(), 1000);
  }

  _tick () {
    if (!this.pos) return;
    const { lat, lng } = this.pos;
    const required     = this.demoMode ? REQUIRED_MS_DEMO : REQUIRED_MS_REAL;
    const all          = [...PUB_DATA, ...TUBE_DATA];

    let nearestId   = null;
    let nearestDist = Infinity;

    for (const loc of all) {
      if (this.discovered.has(loc.id)) continue;

      const dist = this._haversine(lat, lng, loc.lat, loc.lng);

      if (dist <= PROXIMITY_METRES) {
        // Accumulate dwell time
        if (!this.timers[loc.id]) {
          this.timers[loc.id] = { accumulated: 0, location: loc };
        }
        this.timers[loc.id].accumulated += 1000;

        if (this.timers[loc.id].accumulated >= required) {
          this._discoverLocation(loc);
          continue;
        }

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestId   = loc.id;
        }
      }
    }

    // Update nearby glow on markers
    if (nearestId !== this.activeTimerId) {
      if (this.activeTimerId) this._markNearby(this.activeTimerId, false);
      if (nearestId)          this._markNearby(nearestId, true);
      this.activeTimerId = nearestId;
    }

    this._updateTimerUI(nearestId, required);
  }

  // ── Discovery ─────────────────────────────────────────────────────────────────

  _discoverLocation (loc) {
    delete this.timers[loc.id];
    this.discovered.add(loc.id);
    this._saveState();

    // Animated fog reveal
    this.fog.revealAnimated({ lat: loc.lat, lng: loc.lng }, loc.revealRadius);

    // Update marker to "discovered" state
    const entry = this._markers[loc.id];
    if (entry) {
      entry.marker.setIcon(this._buildIcon(loc.id, entry.type));
    }

    this._showNotification(loc.name);
    this._updateStats();
  }

  // ── User marker ───────────────────────────────────────────────────────────────

  _updateUserMarker (lat, lng) {
    const icon = L.divIcon({
      className: '',
      html: '<div class="user-marker-wrap"><div class="user-dot"></div><div class="user-pulse"></div></div>',
      iconSize:   [20, 20],
      iconAnchor: [10, 10]
    });

    if (!this.userMarker) {
      this.userMarker = L.marker([lat, lng], { icon, pane: 'markerPane', zIndexOffset: 1000 })
        .addTo(this.map);
      this.map.setView([lat, lng], 15, { animate: true });
    } else {
      this.userMarker.setLatLng([lat, lng]);
    }
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────

  _updateStats () {
    const pubs  = [...this.discovered].filter(id => PUB_DATA.some(p  => p.id  === id)).length;
    const tubes = [...this.discovered].filter(id => TUBE_DATA.some(t => t.id === id)).length;
    const total = PUB_DATA.length + TUBE_DATA.length;
    const pct   = total ? Math.round((this.discovered.size / total) * 100) : 0;

    document.getElementById('pubs-discovered').textContent  = pubs;
    document.getElementById('tubes-discovered').textContent = tubes;
    document.getElementById('areas-revealed').textContent   = pct + '%';
  }

  _updateTimerUI (locationId, required) {
    const el = document.getElementById('discovery-timer');

    if (!locationId || !this.timers[locationId]) {
      el.classList.add('hidden');
      return;
    }

    const timer = this.timers[locationId];
    const pct   = Math.min(100, (timer.accumulated / required) * 100);
    const elapsed = timer.accumulated;
    const eMin  = Math.floor(elapsed / 60000);
    const eSec  = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
    const tMin  = Math.floor(required / 60000);
    const tSec  = String(Math.floor((required % 60000) / 1000)).padStart(2, '0');

    document.getElementById('timer-name').textContent  = timer.location.name;
    document.getElementById('timer-fill').style.width  = pct + '%';
    document.getElementById('timer-label').textContent = `${eMin}:${eSec} / ${tMin}:${tSec}`;

    // Update Verification UI
    const verifyBtn = document.getElementById('verify-btn');
    if (verifyBtn) {
      // Check if location is a pub by seeing if it exists in PUB_DATA (timer.location may not have 'type')
      const isPub = PUB_DATA.some(p => p.id === locationId);
      if (isPub) {
        verifyBtn.classList.remove('hidden');
      } else {
        verifyBtn.classList.add('hidden');
      }
    }

    el.classList.remove('hidden');
  }

  _showNotification (name) {
    const el = document.getElementById('discovery-notification');
    document.getElementById('notif-name').textContent = name;
    el.classList.remove('hidden');
    // Double rAF ensures the element is painted before the transition triggers
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.classList.add('hidden'), 420);
    }, 3800);
  }

  _showLocationStatus (msg) {
    const el = document.getElementById('location-status');
    document.getElementById('location-text').textContent = msg;
    el.classList.remove('hidden');
  }

  _hideLocationStatus () {
    document.getElementById('location-status').classList.add('hidden');
  }

  // ── Reset ─────────────────────────────────────────────────────────────────────

  _showResetModal () {
    // Build modal dynamically
    if (document.getElementById('reset-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'reset-modal';
    modal.innerHTML = `
      <div class="reset-box">
        <div class="reset-title">RESET PROGRESS?</div>
        <p class="reset-desc">All discovered pubs, tube stops and revealed areas will be lost. This cannot be undone.</p>
        <div class="reset-buttons">
          <button class="btn btn-danger" id="reset-confirm-btn">RESET</button>
          <button class="btn btn-cancel" id="reset-cancel-btn">CANCEL</button>
        </div>
      </div>`;
    document.getElementById('app').appendChild(modal);

    document.getElementById('reset-confirm-btn').addEventListener('click', () => this._doReset());
    document.getElementById('reset-cancel-btn').addEventListener('click', () => modal.remove());
  }

  _doReset () {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
    // Full page reload is the cleanest way to reset all in-memory state
    window.location.reload();
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────

  /**
   * Haversine distance between two lat/lng points (metres).
   */
  _haversine (lat1, lng1, lat2, lng2) {
    const R    = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                 Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  _findById (id) {
    return [...PUB_DATA, ...TUBE_DATA].find(l => l.id === id) || null;
  }

  async _cleanup () {
    if (this._tesseractWorkerPromise) {
      try {
        const worker = await this._tesseractWorkerPromise;
        await worker.terminate();
      } catch (_) { /* ignore */ }
      this._tesseractWorkerPromise = null;
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  window.pubCry = new PubCryApp();
  window.addEventListener('beforeunload', () => window.pubCry._cleanup());
});
