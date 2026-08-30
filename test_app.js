'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-pages.yml'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

assert(!html.includes('cartocdn.com'), 'the HTML must not reference CARTO tiles');
assert(!/user-scalable\s*=\s*no/i.test(html), 'the viewport must allow user scaling');
assert(!/<script[^>]+(?:tensorflow|mobilenet|tesseract)/i.test(html), 'verification libraries must be lazy-loaded');
assert(app.includes('server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base'), 'the app must use the no-key raster provider');
assert(app.includes('_loadVerificationScript'), 'verification dependencies must be loaded on demand');
assert(app.includes('replaceReveals'), 'fog rebuilds must use the batched reveal API');
assert(workflow.includes('needs: test'), 'Pages deployment must wait for validation');
assert(workflow.includes("if: github.event_name != 'pull_request'"), 'Pages deployment must not run on pull requests');
assert(workflow.includes('actions/checkout@v7'), 'checkout should use the current major release');
assert(workflow.includes('actions/configure-pages@v6'), 'configure-pages should use the current major release');
assert(workflow.includes('actions/upload-pages-artifact@v5'), 'upload-pages-artifact should use the current major release');
assert(workflow.includes('actions/deploy-pages@v5'), 'deploy-pages should use the current major release');
assert.strictEqual(manifest.start_url, './', 'the PWA start URL must work on a project Pages site');
assert.strictEqual(manifest.scope, './', 'the PWA scope must match the project Pages site');

for (const icon of manifest.icons) {
  assert(fs.existsSync(path.join(root, icon.src)), `manifest icon is missing: ${icon.src}`);
}

console.log('application configuration checks passed');
