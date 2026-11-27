// API の接続先。ローカル開発時は wrangler dev（8787番）に向ける
window.GTHL_API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? 'http://localhost:8787'
  : 'https://gthl-api.animalb001.workers.dev';
window.GTHL_CONSENT = '2026-11-v1';
