// Gemmer appens egne filer, så appen kan åbnes uden internet. Altid nettet først (så opdateringer kommer med det samme), ellers den gemte udgave.
// Kald til serveren (script.google.com) gemmes aldrig.
var CACHE = 'bilarkiv-app-v14';
var FILES = ['./', 'index.html', 'app.css', 'config.js', 'manifest.webmanifest', 'js/util.js', 'js/docs.js', 'js/todo.js', 'js/ui.js', 'js/store.js', 'js/images.js', 'js/views-list.js', 'js/views-car.js', 'js/views-todo.js', 'js/ad.js', 'js/econ.js', 'js/views-docs.js', 'js/views-bytte.js', 'js/views-econ.js', 'js/main.js', 'icons/logo-hvid.png', 'icons/ikon2-180.png', 'icons/ikon2-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  // Ryd kun vores egne gamle versioner: andre apps ligger på samme adresse.
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('bilarkiv-app-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined);
    });
  }));
});
