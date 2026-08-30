'use strict';

/* global L, PUB_DATA, TUBE_DATA, CRAWL_DATA */

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
/** Minimum metres of movement before a new walked-path point is recorded */
const MIN_WALK_DISTANCE_METRES          = 25;
/** Fog reveal radius (metres) for walked path segments */
const WALKED_PATH_REVEAL_RADIUS         = 50;
/** Fog reveal opacity for walked path segments (partial visibility) */
const WALKED_PATH_REVEAL_OPACITY        = 0.5;
/** Fog reveal radius (metres) for fully-discovered locations */
const DISCOVERED_LOCATION_REVEAL_RADIUS = 500;
/** Maximum number of walked-path points kept in localStorage and memory */
const MAX_WALKED_PATH_POINTS             = 2000;
/** Minimum milliseconds between automatic state saves during walking */
const SAVE_STATE_INTERVAL_MS            = 30 * 1000;
/** Maximum image size accepted by the on-device verification flow */
const MAX_VERIFICATION_IMAGE_BYTES       = 10 * 1024 * 1024;
/** Maximum image dimension accepted by the on-device verification flow */
const MAX_VERIFICATION_IMAGE_DIMENSION   = 4096;
/** Maximum time to wait for a lazily-loaded verification script */
const SCRIPT_LOAD_TIMEOUT_MS             = 30 * 1000;

/** Leaflet-compatible raster layer with no CARTO API key requirement. */
const MAP_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const MAP_ATTRIBUTION = '&copy; <a href="https://www.esri.com/" rel="noopener noreferrer">Esri</a>, HERE, Garmin, (c) <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer">OpenStreetMap contributors</a>, and the GIS user community';

const VERIFICATION_SCRIPTS = {
  tfjs: {
    src: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
    integrity: 'sha384-vE8hbVJ4lezako5rlvE7bY0BVzWlFhZncPlckrqNwcUQpVtgbENTgZ8TBbnPjZre'
  },
  mobilenet: {
    src: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js',
    integrity: 'sha384-oBAqwJ0tv9zzKlbIZyBhhXlEvU/PMrSMqDyOHlEZVC8xWHx4yPySuS7vRikRcYFq'
  },
  tesseract: {
    src: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
    integrity: 'sha384-2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM'
  }
};

// ── PubCryApp ─────────────────────────────────────────────────────────────────

class PubCryApp {

  constructor () {
    /** @type {L.Map} */               this.map           = null;
    /** @type {L.FogOfWar} */          this.fog           = null;
    /** @type {L.Marker|null} */       this.userMarker    = null;
    /** @type {{lat:number,lng:number}|null} */ this.pos  = null;
    /** @type {Set<string>} */         this.discovered    = new Set();
    /** @type {Set<string>} */         this.unlockedCrawls = new Set();
    /** @type {Array<{lat:number,lng:number}>} */ this.walkedPath = [];
    /** @type {Object.<string,{accumulated:number,location:Object}>} */
    this.timers = {};
    /** @type {boolean} */             this.demoMode      = false;
    /** @type {number|null} */         this.watchId       = null;
    /** @type {number|null} */         this.tickId        = null;
    /** @type {string|null} */         this.activeTimerId = null;
    /** @type {number|null} */         this._saveStateTimer = null;
    /** @type {Promise<object>|null} */  this._mobilenetModel = null;
    /** @type {Promise<object>|null} */  this._tesseractWorkerPromise = null;
    /** @type {Object.<string,Promise<void>>} */ this._scriptPromises = {};
    /** @type {Function|null} */          this._demoClickHandler = null;
    /** @type {HTMLElement|null} */       this._activeModal = null;
    /** @type {HTMLElement|null} */       this._focusReturnElement = null;
    /** @type {Function} */               this._modalKeyHandler = this._handleModalKeydown.bind(this);
    /** @type {number|null} */            this._verificationStatusTimer = null;

    this._loadState();
    this._checkCrawls(true); // check for any retroactive unlocks on load
    this._initMap();
    this._initFog();
    this._initMarkers();
    this._bindUI();
    this._updateStats();
    this._initModalAccessibility();
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  _loadState () {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const state = JSON.parse(raw);
        const knownIds = new Set([...PUB_DATA, ...TUBE_DATA].map(location => location.id));
        this.discovered = new Set((state.discovered || []).filter(id => knownIds.has(id)));
        this.unlockedCrawls = new Set(state.unlockedCrawls || []);
        this.walkedPath = this._decimatePath((state.walkedPath || [])
          .filter(pt => pt && Number.isFinite(pt.lat) && Number.isFinite(pt.lng)));
      }
    } catch (_) { /* ignore */ }
  }

  _saveState () {
    if (this._saveStateTimer !== null) {
      clearTimeout(this._saveStateTimer);
      this._saveStateTimer = null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        discovered: [...this.discovered],
        unlockedCrawls: [...this.unlockedCrawls],
        walkedPath: this.walkedPath
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

    L.tileLayer(MAP_TILE_URL, {
      attribution: MAP_ATTRIBUTION,
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

    const areas = this.walkedPath.map(pt => ({
      latlng: { lat: pt.lat, lng: pt.lng },
      radius: WALKED_PATH_REVEAL_RADIUS,
      opacity: WALKED_PATH_REVEAL_OPACITY
    }));
    for (const id of this.discovered) {
      const loc = this._findById(id);
      if (loc) {
        areas.push({
          latlng: { lat: loc.lat, lng: loc.lng },
          radius: this._revealRadiusFor(loc),
          opacity: 1
        });
      }
    }
    this.fog.replaceReveals(areas);
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
    this._setMarkerAccessibility(marker, location);
  }

  _buildIcon (id, type, active = false) {
    const isFound  = this.discovered.has(id);
    const classes  = [
      'map-marker',
      type === 'pub' ? 'pub-marker' : 'tube-marker',
      isFound ? 'discovered' : '',
      active ? 'nearby' : ''
    ].join(' ');
    const emoji = type === 'pub' ? '🍺' : '🚇';
    return L.divIcon({ className: classes, html: `<span aria-hidden="true">${emoji}</span>`, iconSize: [44,44], iconAnchor: [22,22] });
  }

  _buildPopup (location, type) {
    const found   = this.discovered.has(location.id);
    const status  = found ? 'DISCOVERED' : 'UNDISCOVERED';
    const cls     = found ? 'status-discovered' : 'status-unknown';
    const minutes = this.demoMode ? '5 seconds' : '15 minutes';
    return `<div class="popup-content">
      <div class="popup-icon" aria-hidden="true">${type === 'pub' ? '🍺' : '🚇'}</div>
      <h3 class="popup-name">${this._escapeHtml(location.name)}</h3>
      <div class="popup-status ${cls}">${status}</div>
      ${location.description ? `<p class="popup-desc">${this._escapeHtml(location.description)}</p>` : ''}
      ${!found ? `<p class="popup-hint">Stay nearby for ${minutes} to reveal this area</p>` : ''}
    </div>`;
  }

  _updateAllMarkers () {
    for (const id of Object.keys(this._markers)) {
      const { marker, type, location } = this._markers[id];
      marker.setIcon(this._buildIcon(id, type, id === this.activeTimerId));
      this._setMarkerAccessibility(marker, location);
    }
  }

  _markNearby (locationId, active) {
    const entry = this._markers[locationId];
    if (!entry) return;
    const { marker, type, location } = entry;
    marker.setIcon(this._buildIcon(locationId, type, active));
    this._setMarkerAccessibility(marker, location);
  }

  _setMarkerAccessibility (marker, location) {
    const element = marker.getElement && marker.getElement();
    if (!element) return;

    const status = this.discovered.has(location.id) ? ', discovered' : ', undiscovered';
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', `${location.name}${status}`);
    element.setAttribute('title', location.name);
  }

  _refreshAllPopups () {
    if (!this._markers) return;
    for (const { marker, location, type } of Object.values(this._markers)) {
      marker.setPopupContent(this._buildPopup(location, type));
    }
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

    document.getElementById('retry-location-btn').addEventListener('click', () => {
      this.demoMode = false;
      this._startRealLocation();
    });

    document.getElementById('location-demo-btn').addEventListener('click', () => {
      this.demoMode = true;
      this._startDemoMode();
    });

    document.getElementById('locate-btn').addEventListener('click', () => {
      if (this.pos) this.map.setView([this.pos.lat, this.pos.lng], 15, { animate: true });
    });

    document.getElementById('badges-btn').addEventListener('click', () => this._showProfileModal());
    document.getElementById('profile-close-btn').addEventListener('click', () => this._hideProfileModal());
    document.getElementById('profile-modal').addEventListener('click', event => {
      if (event.target === event.currentTarget) this._hideProfileModal();
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
    if (this._verificationStatusTimer !== null) {
      clearTimeout(this._verificationStatusTimer);
      this._verificationStatusTimer = null;
    }
    statusEl.textContent = message;
    statusEl.classList.remove('hidden');
    if (duration > 0) {
      this._verificationStatusTimer = setTimeout(() => {
        statusEl.classList.add('hidden');
        this._verificationStatusTimer = null;
      }, duration);
    }
  }

  async _handleImageVerification(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this._setVerificationStatus('Choose an image file to verify.', 3000);
      event.target.value = '';
      return;
    }

    if (file.size > MAX_VERIFICATION_IMAGE_BYTES) {
      this._setVerificationStatus('Image is too large. Choose one under 10 MB.', 4000);
      event.target.value = '';
      return;
    }

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

      if (image.naturalWidth > MAX_VERIFICATION_IMAGE_DIMENSION ||
          image.naturalHeight > MAX_VERIFICATION_IMAGE_DIMENSION) {
        throw new Error('Image dimensions exceed the verification limit');
      }

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
    if (!loc) return;

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

  _loadVerificationScript (name) {
    const config = VERIFICATION_SCRIPTS[name];
    if (!config) return Promise.reject(new Error(`Unknown verification script: ${name}`));

    const globalName = {
      tfjs: 'tf',
      mobilenet: 'mobilenet',
      tesseract: 'Tesseract'
    }[name];

    if (window[globalName]) return Promise.resolve();
    if (this._scriptPromises[name]) return this._scriptPromises[name];

    this._scriptPromises[name] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let timeoutId = null;
      const fail = (error) => {
        if (timeoutId !== null) clearTimeout(timeoutId);
        script.remove();
        reject(error);
      };

      script.src = config.src;
      script.integrity = config.integrity;
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.dataset.pubcryVerification = name;
      script.onload = () => {
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (window[globalName]) {
          resolve();
        } else {
          fail(new Error(`${name} loaded without exposing ${globalName}`));
        }
      };
      script.onerror = () => fail(new Error(`Could not load ${name}`));
      timeoutId = setTimeout(() => fail(new Error(`${name} load timed out`)), SCRIPT_LOAD_TIMEOUT_MS);
      document.head.appendChild(script);
    }).catch(error => {
      this._scriptPromises[name] = null;
      throw error;
    });

    return this._scriptPromises[name];
  }

  async _verifyWithAI(image) {
    try {
      await this._loadVerificationScript('tfjs');
      await this._loadVerificationScript('mobilenet');

      // Load model once and reuse across calls
      if (!this._mobilenetModel) {
        if (!window.mobilenet || typeof window.mobilenet.load !== 'function') {
          throw new Error('MobileNet is unavailable');
        }
        this._mobilenetModel = window.mobilenet.load().catch(error => {
          this._mobilenetModel = null;
          throw error;
        });
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
      await this._loadVerificationScript('tesseract');

      // Create Tesseract worker once and reuse across calls
      if (!this._tesseractWorkerPromise) {
        if (!window.Tesseract || typeof window.Tesseract.createWorker !== 'function') {
          throw new Error('Tesseract is unavailable');
        }
        this._tesseractWorkerPromise = window.Tesseract.createWorker('eng').catch(error => {
          this._tesseractWorkerPromise = null;
          throw error;
        });
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
    this._closeModal(document.getElementById('welcome-overlay'), false);
  }

  // ── Real geolocation ─────────────────────────────────────────────────────────

  _startRealLocation () {
    this._stopDemoMode();
    this._refreshAllPopups();

    if (!navigator.geolocation) {
      this._showLocationStatus('Geolocation not supported by your browser.');
      this._showLocationRecovery();
      return;
    }

    this._stopWatchingLocation();
    this._hideLocationRecovery();
    this._showLocationStatus('Acquiring GPS signal…');

    this.watchId = navigator.geolocation.watchPosition(
      pos  => {
        this._hideLocationRecovery();
        this._onPosition(pos.coords.latitude, pos.coords.longitude);
      },
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
    this._showLocationRecovery();
  }

  _showLocationRecovery () {
    document.getElementById('retry-location-btn').classList.remove('hidden');
    document.getElementById('location-demo-btn').classList.remove('hidden');
  }

  _hideLocationRecovery () {
    document.getElementById('retry-location-btn').classList.add('hidden');
    document.getElementById('location-demo-btn').classList.add('hidden');
  }

  _stopWatchingLocation () {
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  // ── Demo mode ─────────────────────────────────────────────────────────────────

  _startDemoMode () {
    this._stopWatchingLocation();
    this._stopDemoMode();
    this._refreshAllPopups();
    this._hideLocationRecovery();
    this._hideLocationStatus();
    document.getElementById('demo-banner').classList.remove('hidden');
    // Seed user position in central London
    this._onPosition(51.5145, -0.1079);
    // Let the user click anywhere on the map to "teleport"
    this._demoClickHandler = e => {
      this._onPosition(e.latlng.lat, e.latlng.lng);
    };
    this.map.on('click', this._demoClickHandler);
  }

  _stopDemoMode () {
    if (this._demoClickHandler) {
      this.map.off('click', this._demoClickHandler);
      this._demoClickHandler = null;
    }
    const banner = document.getElementById('demo-banner');
    if (banner) banner.classList.add('hidden');
  }

  // ── Position update (shared by real + demo) ───────────────────────────────────

  _onPosition (lat, lng) {
    this.pos = { lat, lng };

    // Track walked path
    const lastPt = this.walkedPath[this.walkedPath.length - 1];
    const shouldRecord = !lastPt || this._haversine(lat, lng, lastPt.lat, lastPt.lng) > MIN_WALK_DISTANCE_METRES;

    if (shouldRecord) {
      this.walkedPath.push({ lat, lng });
      this.fog.reveal({ lat, lng }, WALKED_PATH_REVEAL_RADIUS, WALKED_PATH_REVEAL_OPACITY);
      if (this.walkedPath.length > MAX_WALKED_PATH_POINTS) {
        this._compactWalkedPath();
      }
      this._scheduleSave();
    }

    this._hideLocationStatus();
    this._updateUserMarker(lat, lng);
    this._startTickIfNeeded();
  }

  _compactWalkedPath () {
    const compacted = this._decimatePath(this.walkedPath);
    if (compacted.length === this.walkedPath.length) return;

    this.walkedPath = compacted;
    this._rebuildFog();
  }

  _rebuildFog () {
    if (!this.fog || typeof this.fog.replaceReveals !== 'function') return;

    const areas = this.walkedPath.map(pt => ({
      latlng: { lat: pt.lat, lng: pt.lng },
      radius: WALKED_PATH_REVEAL_RADIUS,
      opacity: WALKED_PATH_REVEAL_OPACITY
    }));
    for (const id of this.discovered) {
      const loc = this._findById(id);
      if (loc) areas.push({
        latlng: { lat: loc.lat, lng: loc.lng },
        radius: this._revealRadiusFor(loc),
        opacity: 1
      });
    }
    this.fog.replaceReveals(areas);
  }

  _startTickIfNeeded () {
    if (this.tickId !== null) return;
    this.tickId = setInterval(() => this._tick(), 1000);
  }

  /**
   * Schedule a debounced state save so frequent position updates don't
   * hammer localStorage. The state is always flushed on `beforeunload`.
   */
  _scheduleSave () {
    if (this._saveStateTimer !== null) return;
    this._saveStateTimer = setTimeout(() => {
      this._saveStateTimer = null;
      this._saveState();
    }, SAVE_STATE_INTERVAL_MS);
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

  updateFog (latlng) {
    this.fog.revealAnimated({ lat: latlng.lat, lng: latlng.lng }, this._revealRadiusFor(latlng), 1);
  }

  _discoverLocation (loc) {
    if (this.discovered.has(loc.id)) return;
    delete this.timers[loc.id];
    this.discovered.add(loc.id);
    this._saveState();

    // Animated fog reveal
    this.updateFog(loc);

    // Update marker to "discovered" state
    const entry = this._markers[loc.id];
    if (entry) {
      entry.marker.setIcon(this._buildIcon(loc.id, entry.type));
      entry.marker.setPopupContent(this._buildPopup(loc, entry.type));
      this._setMarkerAccessibility(entry.marker, loc);
    }

    this._showNotification(loc.name);
    this._updateStats();
    this._checkCrawls();
  }

  _revealRadiusFor (location) {
    return location && Number.isFinite(location.revealRadius)
      ? location.revealRadius
      : DISCOVERED_LOCATION_REVEAL_RADIUS;
  }

  _checkCrawls (silent = false) {
    if (typeof CRAWL_DATA === 'undefined') return;

    const newlyUnlockedCrawls = [];
    for (const crawl of CRAWL_DATA) {
      if (this.unlockedCrawls.has(crawl.id)) continue;

      const isUnlocked = crawl.required_pubs.every(pubId => this.discovered.has(pubId));
      if (isUnlocked) {
        this.unlockedCrawls.add(crawl.id);
        newlyUnlockedCrawls.push(crawl);
      }
    }

    if (newlyUnlockedCrawls.length > 0) {
      this._saveState();
      if (!silent) {
        let notificationDelay = 4000; // Wait for location notification to disappear
        const notificationDuration = 4500; // 4s display + 0.5s buffer
        newlyUnlockedCrawls.forEach(crawl => {
          setTimeout(() => this._showBadgeNotification(crawl), notificationDelay);
          notificationDelay += notificationDuration;
        });
      }
    }
  }

  _showBadgeNotification (crawl) {
    const el = document.getElementById('discovery-notification');
    el.querySelector('.notif-badge').textContent = 'BADGE UNLOCKED';
    el.querySelector('.notif-name').textContent = crawl.badge + ' ' + crawl.title;
    el.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => {
        el.classList.add('hidden');
        // Reset text
        el.querySelector('.notif-badge').textContent = 'AREA REVEALED';
      }, 420);
    }, 4000);
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
    const knownDiscovered = pubs + tubes;
    const pct   = total ? Math.round((knownDiscovered / total) * 100) : 0;

    document.getElementById('pubs-discovered').textContent  = pubs;
    document.getElementById('tubes-discovered').textContent = tubes;
    document.getElementById('areas-revealed').textContent   = pct + '%';
  }

  _updateTimerUI (locationId, required) {
    const el = document.getElementById('discovery-timer');

    if (!locationId || !this.timers[locationId]) {
      el.classList.add('hidden');
      const progressEl = document.getElementById('timer-progress');
      if (progressEl) {
        progressEl.setAttribute('aria-valuenow', '0');
        progressEl.setAttribute('aria-valuetext', '0 percent');
      }
      return;
    }

    const timer = this.timers[locationId];
    const pct   = Math.min(100, (timer.accumulated / required) * 100);
    const elapsed = timer.accumulated;
    const eMin  = Math.floor(elapsed / 60000);
    const eSec  = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
    const tMin  = Math.floor(required / 60000);
    const tSec  = String(Math.floor((required % 60000) / 1000)).padStart(2, '0');
    const progress = Math.round(pct);

    document.getElementById('timer-name').textContent  = timer.location.name;
    document.getElementById('timer-fill').style.width  = pct + '%';
    document.getElementById('timer-label').textContent = `${eMin}:${eSec} / ${tMin}:${tSec}`;

    const progressEl = document.getElementById('timer-progress');
    if (progressEl) {
      progressEl.setAttribute('aria-valuenow', String(progress));
      progressEl.setAttribute('aria-valuetext', `${progress}% complete, ${eMin} minutes ${eSec} seconds elapsed`);
    }

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
    el.querySelector('.notif-badge').textContent = 'AREA REVEALED';
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
    this._hideLocationRecovery();
  }

  // ── Profile / Badges UI ────────────────────────────────────────────────────────

  _initModalAccessibility () {
    const welcome = document.getElementById('welcome-overlay');
    if (welcome && !welcome.classList.contains('hidden')) {
      this._openModal(welcome, document.getElementById('start-real-btn'));
    }
  }

  _openModal (modal, initialFocus) {
    if (!modal) return;

    if (this._activeModal && this._activeModal !== modal) {
      this._closeModal(this._activeModal, false);
    }

    const activeElement = document.activeElement;
    this._focusReturnElement = activeElement instanceof HTMLElement && !modal.contains(activeElement)
      ? activeElement
      : null;
    this._activeModal = modal;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', this._modalKeyHandler);

    requestAnimationFrame(() => {
      if (initialFocus && typeof initialFocus.focus === 'function') initialFocus.focus();
    });
  }

  _closeModal (modal, restoreFocus = true) {
    if (!modal) return;

    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    if (this._activeModal !== modal) return;

    this._activeModal = null;
    document.removeEventListener('keydown', this._modalKeyHandler);
    const focusTarget = this._focusReturnElement;
    this._focusReturnElement = null;
    if (restoreFocus && focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
  }

  _handleModalKeydown (event) {
    const modal = this._activeModal;
    if (!modal) return;

    if (event.key === 'Escape') {
      if (modal.id === 'profile-modal') this._hideProfileModal();
      if (modal.id === 'reset-modal') this._closeResetModal(modal);
      return;
    }

    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.disabled && element.offsetParent !== null);
    if (focusable.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  _showProfileModal () {
    const listEl = document.getElementById('profile-crawls-list');
    listEl.innerHTML = ''; // clear

    if (typeof CRAWL_DATA !== 'undefined') {
      CRAWL_DATA.forEach(crawl => {
        const isUnlocked = this.unlockedCrawls.has(crawl.id);
        const discoveredCount = crawl.required_pubs.reduce((count, pid) => this.discovered.has(pid) ? count + 1 : count, 0);
        const totalCount = crawl.required_pubs.length;

        const item = document.createElement('div');
        item.className = `crawl-item ${isUnlocked ? 'unlocked' : 'locked'}`;
        item.innerHTML = `
          <div class="crawl-badge">${isUnlocked ? crawl.badge : '🔒'}</div>
          <div class="crawl-info">
            <div class="crawl-title">${crawl.title}</div>
            <div class="crawl-desc">${crawl.description}</div>
            <div class="crawl-progress">${isUnlocked ? 'COMPLETED' : `${discoveredCount} / ${totalCount} PUBS`}</div>
          </div>
        `;
        listEl.appendChild(item);
      });
    }

    const modal = document.getElementById('profile-modal');
    this._openModal(modal, document.getElementById('profile-close-btn'));
  }

  _hideProfileModal () {
    this._closeModal(document.getElementById('profile-modal'));
  }

  // ── Reset ─────────────────────────────────────────────────────────────────────

  _showResetModal () {
    // Build modal dynamically
    if (document.getElementById('reset-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'reset-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'reset-title');
    modal.setAttribute('aria-describedby', 'reset-description');
    modal.innerHTML = `
      <div class="reset-box">
        <h2 class="reset-title" id="reset-title">RESET PROGRESS?</h2>
        <p class="reset-desc" id="reset-description">All discovered pubs, tube stops and revealed areas will be lost. This cannot be undone.</p>
        <div class="reset-buttons">
          <button class="btn btn-danger" id="reset-confirm-btn">RESET</button>
          <button class="btn btn-cancel" id="reset-cancel-btn">CANCEL</button>
        </div>
      </div>`;
    document.getElementById('app').appendChild(modal);

    document.getElementById('reset-confirm-btn').addEventListener('click', () => this._doReset());
    document.getElementById('reset-cancel-btn').addEventListener('click', () => this._closeResetModal(modal));
    modal.addEventListener('click', event => {
      if (event.target === event.currentTarget) this._closeResetModal(modal);
    });
    this._openModal(modal, document.getElementById('reset-cancel-btn'));
  }

  _closeResetModal (modal = document.getElementById('reset-modal')) {
    if (!modal) return;
    this._closeModal(modal);
    modal.remove();
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

  _decimatePath (points) {
    let result = points.slice();
    while (result.length > MAX_WALKED_PATH_POINTS) {
      const reduced = [result[0]];
      for (let i = 1; i < result.length - 1; i += 2) reduced.push(result[i]);
      reduced.push(result[result.length - 1]);
      result = reduced;
    }
    return result;
  }

  _escapeHtml (value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  _findById (id) {
    return [...PUB_DATA, ...TUBE_DATA].find(l => l.id === id) || null;
  }

  async _cleanup () {
    this._stopWatchingLocation();
    this._stopDemoMode();
    if (this.tickId !== null) {
      clearInterval(this.tickId);
      this.tickId = null;
    }
    if (this._saveStateTimer !== null) {
      clearTimeout(this._saveStateTimer);
      this._saveStateTimer = null;
    }
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
  const persistState = () => window.pubCry._saveState();
  window.addEventListener('pagehide', persistState);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistState();
  });
  window.addEventListener('beforeunload', () => {
    persistState();
    window.pubCry._cleanup();
  });
});
