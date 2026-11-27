/* オフラインでも開けるようにする。データや写真を変えたら VERSION を上げる */
const VERSION = 'tatemono-v18-18';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'matcher.js', 'dots.js', 'photoreader.js', 'tripText.js', 'data/cards.json', 'data/trip_text.json', 'data/card_more.json', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  // アプリ本体とデータ：ネット優先（最新を使い、つながらなければ保存分）
  if (same && !/\/(photos|cards|illust|img)\//.test(url.pathname)) {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  // 写真・カード画像（イラスト版 illust/ もふくむ）・フォント：保存分を優先
  if (same || /fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok || r.type === 'opaque') { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); }
      return r;
    })));
  }
});
