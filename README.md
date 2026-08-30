# Pub Cry
Far Cry but for Pubs. Oh, and it's a map. Go somewhere new today

## Deployment

The site is deployed with GitHub Pages from the `main` branch using the workflow at `.github/workflows/deploy-pages.yml`.

To finish setup in GitHub, set **Settings → Pages → Source** to **GitHub Actions**.

## Map provider

Pub Cry uses Esri's World Dark Gray Canvas raster tiles through Leaflet. This is a
drop-in, no-key replacement for the former CARTO layer, which now returns an API
key watermark without an authenticated request. The map attribution is rendered
in the Leaflet control and must remain visible. Esri's free service is intended
for non-commercial use and may be changed or withdrawn, so review the
[Esri service terms](https://www.esri.com/en-us/legal/terms/web-site-service)
before using Pub Cry commercially.

[OpenFreeMap](https://openfreemap.org/) is the preferred longer-term option if
the project moves to a provider with an explicitly public, no-key OSM service.
Its official Leaflet integration uses MapLibre vector tiles, so adopting it is a
larger rendering migration rather than a safe raster URL swap.

## Runtime dependencies

The deployment is a static site. Leaflet 1.9.4 is vendored in `vendor/`, while
TensorFlow.js, MobileNet and Tesseract.js are pinned CDN scripts loaded only
when photo or receipt verification is requested. `npm run validate` covers the
repository's JavaScript checks and fog-of-war tests; the Pages workflow runs it
before publishing.
