# Third-party notices

## Leaflet

The browser bundle in `vendor/leaflet.js` and `vendor/leaflet.css` is Leaflet
1.9.4. See the upstream project and licence at
<https://github.com/Leaflet/Leaflet>.

## Map tiles

Map imagery is requested at runtime from Esri's World Dark Gray Canvas service.
The map displays the service's required attribution. The service is subject to
Esri's current [Web Site and Service Terms of Use](https://www.esri.com/en-us/legal/terms/web-site-service).

## Photo and receipt verification

TensorFlow.js 4.22.0, MobileNet 2.1.1 and Tesseract.js 7.0.0 are loaded from
jsDelivr only after a user chooses photo or receipt verification. They run in
the browser; Pub Cry does not upload the selected image to its own server.
