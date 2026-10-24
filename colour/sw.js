/* AdeStudio Kids – offline support for the on-screen library */
var V = 'ask-colour-v1';
var CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', '../logo-256.png', '../favicon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) {
    return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('ask-colour-') === 0 && k !== V; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function clean(req) { var u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; }

function cacheFirst(req, key) {
  return caches.open(V).then(function (c) {
    return c.match(key || req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        if (r && (r.ok || r.type === 'opaque')) c.put(key || req, r.clone());
        return r;
      });
    });
  });
}

function networkFirst(req, key) {
  return caches.open(V).then(function (c) {
    return fetch(req).then(function (r) {
      if (r && r.ok) c.put(key, r.clone());
      return r;
    }).catch(function () {
      return c.match(key, { ignoreSearch: true }).then(function (hit) {
        return hit || c.match(new URL('./', self.registration.scope).href);
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== location.origin) return;
  var scope = self.registration.scope;
  var inBooks = url.href.indexOf(scope + 'books/') === 0;
  if (inBooks) { e.respondWith(cacheFirst(req, clean(req))); return; }
  if (url.href.indexOf(scope) === 0 && /\.(jpg|png|webp|webmanifest)$/.test(url.pathname)) {
    e.respondWith(cacheFirst(req, clean(req))); return;
  }
  if (url.href.indexOf(scope) === 0 || CORE.some(function (p) { return new URL(p, scope).href === clean(req); })) {
    var key = clean(req);
    if (key === scope + 'index.html') key = scope;
    e.respondWith(networkFirst(req, key));
  }
});

/* The library page sends the list of unlocked books: download any missing ones,
   and quietly refresh the ones already saved (cheap 304 check when unchanged). */
self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type !== 'save' || !Array.isArray(d.books)) return;
  var src = e.source;
  function tell(m) { try { src && src.postMessage(m); } catch (x) {} }
  e.waitUntil(caches.open(V).then(function (c) {
    var done = 0;
    return d.books.reduce(function (p, slug) {
      return p.then(function () {
        if (!/^[a-z-]+$/.test(slug)) return;
        var urls = [scopeUrl('books/' + slug + '.html'), scopeUrl('covers/' + slug + '.jpg')];
        return Promise.all(urls.map(function (u) {
          return c.match(u).then(function (hit) {
            if (hit && !d.refresh) return;
            return fetch(u, { cache: 'no-cache' }).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {});
          });
        })).then(function () {
          return c.match(urls[0]).then(function (hit) { done++; tell({ type: 'saved', slug: slug, ok: !!hit, done: done, total: d.books.length }); });
        });
      });
    }, Promise.resolve());
  }));
});

function scopeUrl(p) { return new URL(p, self.registration.scope).href; }
