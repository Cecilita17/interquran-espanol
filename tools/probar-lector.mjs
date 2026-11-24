#!/usr/bin/env node
// Prueba de integración del lector: sirve el proyecto en local, abre una sura con glosario
// en Chromium (Playwright) y comprueba que cada aleya glosada muestra árabe,
// transliteración y significado en español desde data/al-baqarah/.
// Requiere red hacia api.alquran.cloud y api.qurancdn.com (texto y audio del lector).
//   node tools/probar-lector.mjs [URL] [--sura N] [--sin-qdc]   (por defecto, sura 2)   (sin URL usa un servidor local;
//   --sin-qdc bloquea la API palabra por palabra de Quran.com para comprobar que
//   las glosas estáticas se alinean también con el texto de Al Quran Cloud)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SURAS } from './suras.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const types = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const NO_QDC = process.argv.includes('--sin-qdc');
const argv = process.argv.slice(2);
const CH = argv.includes('--sura') ? Number(argv[argv.indexOf('--sura') + 1]) : 2;
const { slug, aleyas: TOTAL } = SURAS[CH];
let server, base = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--sura');
if (!base) {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
}

const index = JSON.parse(fs.readFileSync(path.join(root, `data/${slug}/index.json`), 'utf8'));
const expected = {};
for (const b of index.bloques) Object.assign(expected, JSON.parse(fs.readFileSync(path.join(root, 'data', slug, b.archivo), 'utf8')).aleyas);

const browser = await chromium.launch();
const page = await browser.newPage();
if (NO_QDC) await page.route(/api\.qurancdn\.com/, r => r.abort());
const errors = [];
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.click(`[data-ch="${CH}"]`, { timeout: 60000 });
  await page.waitForFunction(() => /aleyas con glosas fijas/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
  const status = await page.textContent('#status');
  const shown = await page.$$eval('.ayah', arts => arts.map(a => [...a.querySelectorAll('.word')].map(w => ({
    ar: w.querySelector('.arabic')?.textContent, tr: w.querySelector('.roman')?.textContent, es: w.querySelector('.meaning')?.textContent,
  }))));
  const dir = await page.$eval('.words', el => getComputedStyle(el).direction);
  if (shown.length !== TOTAL) errors.push(`El lector muestra ${shown.length} aleyas (se esperaban ${TOTAL})`);
  if (dir !== 'rtl') errors.push('Las palabras no se muestran de derecha a izquierda');
  for (const [v, words] of Object.entries(expected)) {
    const got = shown[Number(v) - 1] || [];
    if (got.length !== words.length) { errors.push(`${CH}:${v}: el lector muestra ${got.length} palabras (se esperaban ${words.length})`); continue; }
    words.forEach((w, i) => {
      const g = got[i];
      if (g.ar !== w.ar || g.es !== w.es || g.tr !== w.tr) errors.push(`${CH}:${v}:${i + 1}: el lector muestra «${g.ar} / ${g.tr} / ${g.es}»`);
    });
  }
  if (!new RegExp(Object.keys(expected).length + ' aleyas con glosas fijas').test(status) || /requieren revisión de alineación/.test(status)) errors.push('Estado inesperado: ' + status);
  console.log('Estado del lector:', status);
  console.log(`Aleyas verificadas en el lector: ${Object.keys(expected).length}`);
} finally {
  await browser.close();
  server?.close();
}
if (errors.length) { console.error('✗ ' + errors.slice(0, 50).join('\n')); process.exit(1); }
console.log('✓ El lector carga y muestra los glosarios estáticos correctamente');
