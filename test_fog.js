'use strict';

const assert = require('assert');

// ── Lightweight Leaflet mock ──────────────────────────────────────────────────
// Provides only the subset of the Leaflet API that FogOfWar actually uses.

global.L = {
  Layer: {
    extend: function (props) {
      function Klass (options) {
        if (props.initialize) props.initialize.call(this, options);
      }
      Object.assign(Klass.prototype, props);
      return Klass;
    }
  },
  setOptions: function (obj, options) {
    const defaults = obj.constructor && obj.constructor.prototype.options
      ? obj.constructor.prototype.options
      : {};
    obj.options = Object.assign({}, defaults, options || {});
  },
  latLng: function (latlng) {
    if (latlng && typeof latlng === 'object' && 'lat' in latlng) {
      return { lat: latlng.lat, lng: latlng.lng };
    }
    return latlng;
  }
};

// requestAnimationFrame is not available in Node – stub it so revealAnimated
// can register its first tick without throwing.
global.requestAnimationFrame = function (fn) { return 0; };

// Load the module under test (registers L.FogOfWar on the global L).
require('./js/fogOfWar.js');

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeFog () {
  const fog = new global.L.FogOfWar();
  // Suppress _draw; it needs a real canvas / map which isn't available here.
  fog._draw = function () {};
  return fog;
}

let passed = 0;
let failed = 0;

function test (name, fn) {
  try {
    fn();
    console.log('  ✓', name);
    passed++;
  } catch (e) {
    console.error('  ✗', name);
    console.error('   ', e.message);
    failed++;
  }
}

// ── reveal tests ──────────────────────────────────────────────────────────────

console.log('\nreveal()');

test('adds one entry to _revealedAreas', () => {
  const fog = makeFog();
  fog.reveal({ lat: 51.5, lng: -0.1 }, 400);
  assert.strictEqual(fog._revealedAreas.length, 1);
});

test('stores the correct radius', () => {
  const fog = makeFog();
  fog.reveal({ lat: 51.5, lng: -0.1 }, 400);
  assert.strictEqual(fog._revealedAreas[0].radius, 400);
});

test('default opacity is 1', () => {
  const fog = makeFog();
  fog.reveal({ lat: 51.5, lng: -0.1 }, 400);
  assert.strictEqual(fog._revealedAreas[0].opacity, 1);
});

test('explicit opacity 0.5 is stored correctly', () => {
  const fog = makeFog();
  fog.reveal({ lat: 51.5, lng: -0.1 }, 50, 0.5);
  assert.strictEqual(fog._revealedAreas[0].opacity, 0.5);
});

test('accumulates multiple areas independently', () => {
  const fog = makeFog();
  fog.reveal({ lat: 51.5, lng: -0.1 }, 50, 0.5);
  fog.reveal({ lat: 51.6, lng: -0.2 }, 500, 1);
  assert.strictEqual(fog._revealedAreas.length, 2);
  assert.strictEqual(fog._revealedAreas[0].opacity, 0.5);
  assert.strictEqual(fog._revealedAreas[1].opacity, 1);
});

// ── revealAnimated tests ──────────────────────────────────────────────────────

console.log('\nrevealAnimated()');

test('immediately adds one entry to _revealedAreas', () => {
  const fog = makeFog();
  fog.revealAnimated({ lat: 51.5, lng: -0.1 }, 400);
  assert.strictEqual(fog._revealedAreas.length, 1);
});

test('initial radius of the entry is 0 (animation starts at zero)', () => {
  const fog = makeFog();
  fog.revealAnimated({ lat: 51.5, lng: -0.1 }, 400);
  assert.strictEqual(fog._revealedAreas[0].radius, 0);
});

test('default opacity is 1', () => {
  const fog = makeFog();
  fog.revealAnimated({ lat: 51.5, lng: -0.1 }, 400);
  assert.strictEqual(fog._revealedAreas[0].opacity, 1);
});

test('explicit opacity 0.7 is stored correctly', () => {
  const fog = makeFog();
  fog.revealAnimated({ lat: 51.5, lng: -0.1 }, 500, 0.7);
  assert.strictEqual(fog._revealedAreas[0].opacity, 0.7);
});

test('reveal and revealAnimated entries coexist in _revealedAreas', () => {
  const fog = makeFog();
  fog.reveal({ lat: 51.5, lng: -0.1 }, 50, 0.5);
  fog.revealAnimated({ lat: 51.6, lng: -0.2 }, 500, 1);
  assert.strictEqual(fog._revealedAreas.length, 2);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
