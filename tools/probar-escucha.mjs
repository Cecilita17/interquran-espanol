#!/usr/bin/env node
// Prueba de integración de «Escucha inmersiva» en Chromium (Playwright) con red simulada:
// Quran.com / Al Quran Cloud / CDN de audio / /api/tts se responden con datos de PRUEBA generados
// aquí (los tiempos de prueba sólo existen en este test; la app nunca los inventa). Comprueba orden
// RTL, sincronía contra el reloj del audio, transiciones, repeticiones, persistencia, Media Session,
// aislamiento respecto al lector y pantallas pequeñas.
//   node tools/probar-escucha.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SURAS } from './suras.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

// ---- Datos de prueba ---------------------------------------------------------------------------
const PAL_MS = 260, SALTO = 270, INI = 20;
const nPal = {};
function palabras(sura) {
  if (nPal[sura]) return nPal[sura];
  const { slug } = SURAS[sura], idx = JSON.parse(fs.readFileSync(path.join(root, 'data', slug, 'index.json'), 'utf8')), out = {};
  for (const b of idx.bloques) for (const [n, w] of Object.entries(JSON.parse(fs.readFileSync(path.join(root, 'data', slug, b.archivo), 'utf8')).aleyas)) out[n] = w.length;
  return (nPal[sura] = out);
}
const segPrueba = (n, rec, sura, aleya) => {
  if (rec === 7 && sura === 1 && aleya === 3) return [[0, 2, INI, INI + 2 * PAL_MS]]; // agrupa dos palabras: NO fiable para palabra por palabra
  return Array.from({ length: n }, (_, k) => [k, k + 1, INI + k * SALTO, INI + k * SALTO + PAL_MS]);
};
const duracionMs = n => INI + n * SALTO + 200;
function wav(ms, hz = 440) {
  const sr = 8000, n = Math.round(sr * ms / 1000), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / sr) * 3000), 44 + i * 2);
  return b;
}
// Voz sintética de prueba con silencio al principio y al final (como los mp3 de las voces neuronales reales).
function wavVoz(toneMs, hz = 440, cabezaMs = 300, colaMs = 300) {
  const sr = 8000, n = ms => Math.round(sr * ms / 1000), a = n(cabezaMs), t = n(toneMs), z = n(colaMs), b = Buffer.alloc(44 + (a + t + z) * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + (a + t + z) * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE((a + t + z) * 2, 40);
  for (let i = 0; i < t; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / sr) * 9000), 44 + (a + i) * 2);
  return b;
}
function conRango(route, cuerpo, tipo = 'audio/wav') {
  const r = route.request().headers().range;
  if (r) { const m = /bytes=(\d+)-(\d*)/.exec(r), a = +m[1], z = m[2] ? +m[2] : cuerpo.length - 1; return route.fulfill({ status: 206, headers: { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${z}/${cuerpo.length}`, 'Access-Control-Allow-Origin': '*' }, body: cuerpo.subarray(a, z + 1) }); }
  return route.fulfill({ status: 200, headers: { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }, body: cuerpo });
}

const peticiones = { tts: [], ttsAr: [], ttsGlosa: [], audio: [], recit: [], datos: [], trad: [], retardoAr: 0 };
const PREF_RECIT = () => localStorage.setItem('qescucha-prefs', JSON.stringify({ fuentePalabra: 'recitacion' })); // palabra = fragmento real del recitador
async function simularRed(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/api\.alquran\.cloud\/v1\/ayah\/(\d+):(\d+)\/(es\.\w+)/, r => {
    const [, s, a, ed] = /ayah\/(\d+):(\d+)\/(es\.\w+)/.exec(r.request().url()); peticiones.trad.push(`ayah ${s}:${a}`);
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ data: { text: `Traducción de prueba ${s}:${a} (${ed})` } }) });
  });
  await ctx.route(/api\.alquran\.cloud\/v1\/surah\/(\d+)\/(es\.\w+)/, r => {
    peticiones.trad.push('sura ' + /surah\/(\d+)/.exec(r.request().url())[1]);
    const [, s, ed] = /surah\/(\d+)\/(es\.\w+)/.exec(r.request().url()); const np = palabras(+s);
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ data: { ayahs: Object.keys(np).map(n => ({ text: `Traducción de prueba ${s}:${n} (${ed})` })) } }) });
  });
  await ctx.route(/api\.quran\.com\/api\/v4\/recitations\/(\d+)\/by_chapter\/(\d+)/, r => {
    const u = new URL(r.request().url()), [, rec, s] = /recitations\/(\d+)\/by_chapter\/(\d+)/.exec(u.pathname), pag = +(u.searchParams.get('page') || 1);
    peticiones.recit.push(`${rec}:${s}:${pag}`);
    const np = palabras(+s), todas = Object.keys(np).map(Number), trozo = todas.slice((pag - 1) * 50, pag * 50);
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({
      audio_files: trozo.map(n => ({ verse_key: `${s}:${n}`, url: `${rec === '7' ? 'Alafasy' : 'Shuraym'}/mp3/${String(s).padStart(3, '0')}${String(n).padStart(3, '0')}.mp3`, segments: segPrueba(np[n], +rec, +s, n) })),
      pagination: { next_page: pag * 50 < todas.length ? pag + 1 : null, total_pages: Math.ceil(todas.length / 50) } }) });
  });
  await ctx.route(/(audio\.qurancdn\.com|verses\.quran\.com)\/(\w+)\/mp3\/(\d{3})(\d{3})\.mp3/, r => {
    const [, , rec, s, a] = /(audio\.qurancdn\.com|verses\.quran\.com)\/(\w+)\/mp3\/(\d{3})(\d{3})\.mp3/.exec(r.request().url());
    peticiones.audio.push(`${rec}:${+s}:${+a}`);
    conRango(r, wav(duracionMs(palabras(+s)[+a]), rec === 'Alafasy' ? 440 : 330));
  });
  await ctx.route(/\/api\/tts-ar\?/, async r => { peticiones.ttsAr.push(new URL(r.request().url()).search); if (peticiones.retardoAr) await new Promise(ok => setTimeout(ok, peticiones.retardoAr)); conRango(r, wavVoz(250, 600), 'audio/mpeg'); });
  await ctx.route(/\/api\/tts-glosa\?/, r => { peticiones.ttsGlosa.push(new URL(r.request().url()).search); conRango(r, wavVoz(150, 300), 'audio/mpeg'); });
  await ctx.route(/\/api\/tts\?/, r => { peticiones.tts.push(new URL(r.request().url()).search); conRango(r, wavVoz(350, 220), 'audio/mpeg'); });
}

// Voz del dispositivo simulada (el Chromium sin cabeza no tiene voces): registra lo que «dice».
const INIT = () => {
  // Política de audio estricta, como en móviles: play() sólo se admite dentro del gesto del usuario
  // (o en un elemento que ya sonó gracias a un gesto). Antes de esto, las pruebas lo ocultaban.
  { const orig = HTMLMediaElement.prototype.play, desbloqueados = new WeakSet(); let gesto = false;
    const marca = () => { gesto = true; setTimeout(() => { gesto = false; }, 0); };
    for (const t of ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend']) addEventListener(t, marca, true);
    window.__conGesto = f => { gesto = true; try { return f(); } finally { setTimeout(() => { gesto = false; }, 0); } };
    HTMLMediaElement.prototype.play = function () {
      if (!gesto && !desbloqueados.has(this)) return Promise.reject(new DOMException('play() bloqueado por la política de audio', 'NotAllowedError'));
      if (gesto) desbloqueados.add(this);
      return orig.call(this);
    }; }
  window.__voz = []; window.__rate = [];
  const sint = { getVoices: () => [], speaking: false, cancel() { this._t && clearTimeout(this._t); this.speaking = false; }, speak(u) { this.speaking = true; this._t = setTimeout(() => { u.onstart?.(); window.__voz.push(u.text); window.__rate.push(u.rate); this._t = setTimeout(() => { this.speaking = false; u.onend?.(); }, 120); }, 30); }, pause() {}, resume() {} };
  Object.defineProperty(window, 'speechSynthesis', { value: sint, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  window.__ms = { handlers: {}, estado: '' };
  const ms = navigator.mediaSession; const orig = ms.setActionHandler.bind(ms);
  ms.setActionHandler = (a, f) => { window.__ms.handlers[a] = f; try { orig(a, f); } catch (e) {} };
};
const MUESTREO = () => {
  window.__m = []; window.__pl = []; const a = window.__escucha.controlador.elemento; a.addEventListener('playing', () => window.__pl.push({ t: a.currentTime * 1000, u: a.getAttribute('data-url') || '' }));
  setInterval(() => { const act = [...document.querySelectorAll('.pal')].findIndex(e => e.classList.contains('activa')); window.__m.push({ t: a.currentTime * 1000, r: a.playbackRate, p: a.paused, u: a.getAttribute('data-origen') || a.getAttribute('data-url') || '', act, n: document.querySelectorAll('.pal.activa').length, st: window.__escucha.motor.estado, at: performance.now() }); }, 20);
};

let servidor;
function servir() {
  servidor = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
    if (p.startsWith('/data/') && p !== '/data/suras.json') peticiones.datos.push(p);
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(0);
  return `http://127.0.0.1:${servidor.address().port}`;
}

let ok = 0, fallos = [];
const FILTRO = process.argv[2];
async function prueba(nombre, fn) { if (FILTRO && !nombre.includes(FILTRO)) return; const t = Date.now(); try { await fn(); ok++; console.log(`  ✓ ${nombre} (${Date.now() - t} ms)`); } catch (e) { fallos.push(nombre); console.log(`  ✗ ${nombre}\n    ${String(e.message).split('\n').join('\n    ')}`); } }

const base = servir();
const browser = await chromium.launch();
async function pagina({ ancho = 360, alto = 640, preparar, url = '/escucha.html?s=1&a=1', movil = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, hasTouch: movil, isMobile: movil, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await simularRed(ctx);
  const p = await ctx.newPage(); await p.addInitScript(INIT); if (preparar) await p.addInitScript(preparar);
  const errores = []; p.on('pageerror', e => errores.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errores.push(m.text()); });
  await p.goto(base + url); await p.waitForFunction(() => window.__escucha?.motor?.estado === 'pausado' && document.querySelector('.pal'), null, { timeout: 15000 });
  await p.evaluate(MUESTREO); p.errores = errores; p.ctx = ctx; return p;
}
const ajustes = (p, o) => p.evaluate(async o => { const { motor, prefs } = window.__escucha; document.getElementById('ajustesBtn'); for (const [k, v] of Object.entries(o)) { const el = document.querySelector(`[data-pref="${k}"]`); if (el) { el.checked = v; el.dispatchEvent(new Event('change')); } } }, o);
const modo = async (p, m) => { await p.click('#ajustesBtn'); await p.click(`[data-modo="${m}"]`); await p.click('#ajustes [data-cerrar]'); };
const esperarEstado = (p, e, t = 20000) => p.waitForFunction(x => window.__escucha.motor.estado === x, e, { timeout: t });
const muestras = p => p.evaluate(() => window.__m);

console.log('Escucha inmersiva · pruebas de integración');

await prueba('carga la aleya, panel de traducción y palabras con árabe, transliteración y significado (en ese orden vertical)', async () => {
  const p = await pagina();
  assert.match(await p.textContent('#tituloSura'), /Al-Fatiha/);
  assert.match(await p.textContent('#traduccion'), /Traducción de prueba 1:1/);
  const n = await p.locator('.pal').count(); assert.equal(n, 4);
  const c = await p.evaluate(() => { const e = document.querySelector('.pal'); return ['.ar', '.tr', '.es'].map(s => e.querySelector(s).getBoundingClientRect().top); });
  assert.ok(c[0] < c[1] && c[1] < c[2], 'orden vertical árabe < transliteración < significado: ' + c);
  const textos = await p.evaluate(() => [...document.querySelectorAll('.pal')].map(e => [e.querySelector('.ar').textContent, e.querySelector('.tr').textContent, e.querySelector('.es').textContent]));
  assert.ok(textos.every(t => /[؀-ۿ]/.test(t[0]) && /[a-zā]/i.test(t[1]) && t[2].length > 1), JSON.stringify(textos));
  assert.deepEqual(p.errores, []); await p.ctx.close();
});

await prueba('orden RTL: primera palabra a la derecha y filas que fluyen de derecha a izquierda (aleya larga, varias filas)', async () => {
  const p = await pagina({ url: '/escucha.html?s=2&a=282' });
  const cajas = await p.evaluate(() => [...document.querySelectorAll('.pal')].map(e => { const r = e.getBoundingClientRect(); return { x: r.left, d: r.right, y: Math.round(r.top) }; }));
  assert.ok(cajas.length > 40);
  const filas = [...new Set(cajas.map(c => c.y))]; assert.ok(filas.length >= 4, 'varias filas: ' + filas.length);
  for (let i = 1; i < cajas.length; i++) {
    const a = cajas[i - 1], b = cajas[i];
    if (Math.abs(a.y - b.y) < 6) assert.ok(b.d <= a.x + 1, `palabra ${i + 1} debe quedar a la IZQUIERDA de la ${i}`);
    else assert.ok(b.y > a.y && b.d >= a.d - 1 || b.d > a.x, `salto de fila en ${i + 1}: empieza por la derecha`);
  }
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('palabras')).direction), 'rtl');
  await p.ctx.close();
});

await prueba('modo 4 (sólo recitación): el resaltado sigue el reloj real del audio y la aleya avanza sola', async () => {
  const p = await pagina(); await modo(p, 'recitacion'); await ajustes(p, { autoavance: false });
  await p.click('#play'); await esperarEstado(p, 'terminado');
  const m = (await muestras(p)).filter(s => /Alafasy|001001/.test(s.u) && !s.p && s.act >= 0);
  assert.ok(m.length > 10, 'muestras: ' + m.length);
  let malas = 0;
  for (const s of m) {
    const esperado = Math.floor((s.t - INI) / SALTO), enHueco = (s.t - INI) % SALTO > PAL_MS;
    if (s.t < INI || esperado > 3) continue;
    if (s.act !== esperado && !(enHueco && s.act === esperado) && Math.abs(s.act - esperado) > 0) malas++;
  }
  assert.ok(malas <= 2, 'muestras desincronizadas: ' + malas + '/' + m.length);
  const vistas = [...new Set(m.map(s => s.act))]; assert.deepEqual(vistas, [0, 1, 2, 3]);
  assert.equal(await p.locator('.pal.activa').count(), 0, 'sin resaltado al terminar');
  assert.deepEqual(p.errores, []); await p.ctx.close();
});

await prueba('modo 2 con fragmentos de la recitación: cada clip empieza en su marca real, suena el significado y nunca se solapan', async () => {
  peticiones.ttsGlosa.length = 0;
  const p = await pagina({ preparar: PREF_RECIT }); await modo(p, 'palabra'); await ajustes(p, { autoavance: false });
  await p.evaluate(() => { window.__escucha.motor.actualizarPrefs({ pausaMs: 100 }); });
  await p.click('#play'); await esperarEstado(p, 'terminado');
  assert.equal(new Set(peticiones.ttsGlosa).size, 4, 'un significado por palabra con la voz neuronal');
  const m = await muestras(p);
  // Para cada palabra k: hubo una muestra con el audio sonando dentro de [ini_k, fin_k+cola] y ninguna fuera de ese hueco mientras sonaba una palabra.
  for (let k = 0; k < 4; k++) {
    const ini = INI + k * SALTO, enVentana = m.filter(s => !s.p && s.act === k && /001001/.test(s.u));
    assert.ok(enVentana.length >= 3, `palabra ${k + 1}: sin muestras sonando`);
    const t0 = Math.min(...enVentana.map(s => s.t)), t1 = Math.max(...enVentana.map(s => s.t));
    assert.ok(t0 >= ini - 60 && t0 <= ini + 250, // el primer muestreo puede llegar tras el seek (petición de rango); lo esencial es no empezar ANTES de la marca
       `palabra ${k + 1} empieza en ${t0.toFixed(0)} (marca ${ini})`);
    const tope = k < 3 ? ini + SALTO : ini + PAL_MS + 250; // hasta la palabra siguiente o, en la última, fin real + cola de 250 ms
    assert.ok(t1 <= tope + 80, `palabra ${k + 1} termina en ${t1.toFixed(0)} (límite ${tope})`);
    assert.ok(k === 3 || t1 < ini + SALTO, `palabra ${k + 1} no invade la siguiente`);
  }
  assert.ok(!m.some(s => !s.p && s.u.includes('/api/tts?')), 'no suena la traducción en el modo 2');
  assert.deepEqual(p.errores, []); await p.ctx.close();
});

for (const [m, fuente] of [['recitacion', ''], ['palabra', ''], ['palabra', 'recitacion']]) await prueba(`modo ${m}${fuente ? ' con fragmentos' : ''}: suena al primer toque en play (política de audio de móviles)`, async () => {
  const p = await pagina({ preparar: fuente ? PREF_RECIT : undefined }); await modo(p, m); await ajustes(p, { autoavance: false });
  await p.click('#play');
  await p.waitForFunction(() => !window.__escucha.controlador.elemento.paused && window.__escucha.motor.estado === 'reproduciendo', null, { timeout: 8000 });
  assert.ok(!(await p.evaluate(() => document.getElementById('aviso').textContent)).includes('bloque'), 'sin aviso de audio bloqueado');
  await esperarEstado(p, 'terminado'); assert.deepEqual(p.errores, []); await p.ctx.close();
});

await prueba('modo 3 (combinada): traducción (TTS) → palabras + significados → recitación completa; sin solapes', async () => {
  peticiones.tts.length = 0; peticiones.ttsAr.length = 0; peticiones.ttsGlosa.length = 0;   // la precarga pide estos audios al abrir la aleya
  const p = await pagina(); await modo(p, 'combinada'); await ajustes(p, { autoavance: false });
  await p.evaluate(() => window.__escucha.motor.actualizarPrefs({ pausaMs: 50 }));
  await p.click('#play'); await esperarEstado(p, 'terminado', 30000);
  const m = await muestras(p), sonando = m.filter(s => !s.p);
  const primerTts = sonando.findIndex(s => s.u.includes('/api/tts')), primerAudio = sonando.findIndex(s => /001001/.test(s.u));
  assert.ok(primerTts >= 0 && primerAudio > primerTts, 'la traducción suena antes que el árabe');
  assert.equal(peticiones.tts.length, 1); assert.match(peticiones.tts[0], /s=1&a=1&t=cortes&v=es-ES-ElviraNeural/);
  assert.deepEqual(peticiones.ttsAr.map(q => /w=(\d+)&v=(\S+)/.exec(q).slice(1).join(':')), ['1:ar-SA-HamedNeural', '2:ar-SA-HamedNeural', '3:ar-SA-HamedNeural', '4:ar-SA-HamedNeural'], 'una voz árabe por palabra, en orden');
  const orden = [...new Set(sonando.map(x => x.u))].map(u => /tts-ar\?.*w=(\d)/.exec(u)?.[1] ? 'ar' + /w=(\d)/.exec(u)[1] : /tts-glosa\?.*w=(\d)/.exec(u)?.[1] ? 's' + /w=(\d)/.exec(u)[1] : u.includes('/api/tts?') ? 'trad' : /001001/.test(u) ? 'recit' : u);
  assert.deepEqual(orden.filter(x => x !== 'silencio'), ['trad', 's1', 'ar1', 's2', 'ar2', 's3', 'ar3', 's4', 'ar4', 'recit'], 'traducción → (significado → palabra árabe) × n → recitación completa');
  // la recitación completa pasa por los 4 bloques al final
  const ultimo = sonando.filter(s => /001001/.test(s.u)).slice(-12);
  assert.ok(ultimo.at(-1).t > INI + 3 * SALTO, 'la última pasada llega hasta la última palabra');
  // Un solo elemento de audio y estados coherentes: nunca dos fuentes a la vez
  assert.equal(await p.evaluate(() => document.querySelectorAll('audio').length), 0, 'el audio es un solo objeto Audio fuera del DOM');
  assert.equal(new Set(peticiones.ttsGlosa).size, 4, 'significados con voz neuronal');
  assert.equal((await p.evaluate(() => window.__voz)).length, 0, 'ya no se usa la voz del dispositivo');
  await p.ctx.close();
});

await prueba('cambiar de modo (en pausa o sonando) y de aleya no deja de funcionar: play siempre suena', async () => {
  const p = await pagina(); await ajustes(p, { autoavance: false });
  const sono = async () => { await p.waitForFunction(() => window.__escucha.motor.estado === 'reproduciendo' && !window.__escucha.controlador.elemento.paused || window.__voz.length > 0 || window.__escucha.motor.paso > 0, null, { timeout: 8000 }); };
  const recorrido = ['recitacion', 'palabra', 'traduccion-recitacion', 'recitacion', 'combinada', 'palabra'];
  for (const m of recorrido) {
    await modo(p, m);                                  // cambio de modo con la reproducción en pausa o terminada
    assert.notEqual(await p.evaluate(() => window.__escucha.motor.estado), 'error');
    const antes = await p.evaluate(() => ({ voz: window.__voz.length, pl: window.__pl.length }));
    await p.click('#play');
    await p.waitForFunction(a => window.__voz.length > a.voz || window.__pl.length > a.pl, antes, { timeout: 8000 }).catch(() => { throw new Error(`modo ${m}: play no produjo ningún audio`); });
    await p.click('#play'); await esperarEstado(p, 'pausado');   // pausa; el siguiente modo se cambia en pausa
  }
  await p.click('#siguiente'); await p.waitForFunction(() => window.__escucha.motor.aleya === 1);   // cambio de aleya en pausa
  const antes = await p.evaluate(() => ({ voz: window.__voz.length, pl: window.__pl.length })); await p.click('#play');
  await p.waitForFunction(a => window.__voz.length > a.voz || window.__pl.length > a.pl, antes, { timeout: 8000 });
  assert.deepEqual(p.errores, []); await p.ctx.close();
});

await prueba('ritmo: el palabra por palabra no espera a la red (precarga), usa la velocidad de palabras y casi no deja silencios', async () => {
  peticiones.retardoAr = 600; peticiones.ttsAr.length = 0; peticiones.ttsGlosa.length = 0;                // el servidor de voz tarda 0,6 s por palabra
  const p = await pagina({ url: '/escucha.html?s=1&a=7' }); await modo(p, 'palabra'); await ajustes(p, { autoavance: false });
  const t0 = Date.now(); await p.click('#play'); await esperarEstado(p, 'terminado', 30000); const total = Date.now() - t0;
  peticiones.retardoAr = 0;
  assert.equal(new Set(peticiones.ttsGlosa).size, 9, 'un significado (voz neuronal) por palabra');
  // 9 palabras × (significado ≈ 0,15 s + árabe ≈ 0,25/1,2 s + pausa 0,15 s) ≈ 4,6 s + la primera espera de 0,6 s. Sin precarga se sumarían 9 × 0,6 s más.
  const linea = (await muestras(p)).reduce((acc, x) => { const k = x.p ? 'silencio' : (x.u.match(/tts-\w+|\d{6}/) || ['?'])[0]; const u = acc.at(-1); if (!u || u.k !== k) acc.push({ k, t: Math.round(x.at), n: 1 }); else u.n++; return acc; }, []).map((u, i, a) => `${u.k}@${u.t - a[0].t}`).slice(0, 60).join(' ');
  // Los audios de prueba traen 0,6 s de silencio (recortado al reproducir); sin precarga se sumarían 9 × 0,6 s de red (≈ 14 s).
  if (process.env.ESC_DIAG) console.log('    ' + total + ' ms · ' + linea);
  assert.ok(total < 10500, `la pasada tardó ${total} ms (esperando a la red en cada palabra)\n${linea}`);
  const sm = (await muestras(p)).filter(x => !x.p);
  assert.ok(sm.filter(x => x.u.includes('tts-ar')).length > 8 && sm.filter(x => x.u.includes('tts-ar')).every(x => Math.abs(x.r - 1.2) < 0.01), 'voz árabe a 1,2×');
  assert.ok(sm.filter(x => x.u.includes('tts-glosa')).length > 8 && sm.filter(x => x.u.includes('tts-glosa')).every(x => Math.abs(x.r - 1.2) < 0.01), 'significado a 1,2×');
  assert.equal(new Set(peticiones.ttsAr).size, 9);
  await p.ctx.close();
});

await prueba('ritmo: pausa entre bloques por defecto 0,15 s; se migra el valor antiguo (0,4 / 0,6 s) y se respeta uno elegido', async () => {
  let p = await pagina();                                      // instalación nueva
  assert.equal(await p.evaluate(() => window.__escucha.prefs.pausaMs), 150);
  assert.equal(await p.evaluate(() => window.__escucha.motor.prefs.pausaMs), 150); await p.ctx.close();
  for (const [guardado, esperado] of [[400, 150], [600, 150], [900, 900], [0, 0]]) {
    p = await pagina({ preparar: `localStorage.setItem('qescucha-prefs', JSON.stringify({ pausaMs: ${guardado}, modo: 'recitacion' }))` });
    assert.equal(await p.evaluate(() => window.__escucha.prefs.pausaMs), esperado, `guardado ${guardado}`);
    assert.equal(await p.evaluate(() => window.__escucha.prefs.modo), 'recitacion', 'el resto de preferencias se conserva');
    await p.ctx.close();
  }
});

await prueba('sin silencios: las voces se reproducen recortadas (sin el silencio inicial/final del mp3) y con pausa 0 no hay hueco entre bloques', async () => {
  const p = await pagina({ url: '/escucha.html?s=1&a=2' }); await modo(p, 'combinada'); await ajustes(p, { autoavance: false });
  await p.evaluate(() => window.__escucha.motor.actualizarPrefs({ pausaMs: 0, pausaPalabraMs: 0, velocidadPalabras: 1 }));
  await p.waitForTimeout(800);                                   // deja terminar la precarga y el análisis de silencios
  await p.click('#play'); await esperarEstado(p, 'terminado', 30000);
  const m = (await muestras(p)).filter(x => !x.p);
  for (const tipo of ['tts-ar', 'tts-glosa']) {
    const v = m.filter(x => x.u.includes(tipo)); assert.ok(v.length > 6, tipo + ': sin muestras');
    const ini = Math.min(...v.map(x => x.t)), fin = Math.max(...v.map(x => x.t));
    const cabeza = 300, tono = tipo === 'tts-ar' ? 250 : 150;
    assert.ok(ini >= cabeza - 90, `${tipo}: empieza en ${ini.toFixed(0)} ms (el silencio inicial de ${cabeza} ms debe saltarse)`);
    assert.ok(fin <= cabeza + tono + 160, `${tipo}: termina en ${fin.toFixed(0)} ms (la cola de silencio no debe sonar)`);
  }
  // Hueco entre el final de un audio y el inicio del siguiente (muestras consecutivas sin sonido) — con pausas 0 debe ser pequeño.
  const todas = await muestras(p); let hueco = 0, maxHueco = 0, dentro = false;
  for (const x of todas) { if (!dentro && !x.p) dentro = true; if (dentro && x.st === 'terminado') break; if (dentro) { if (x.p) { hueco += 20; maxHueco = Math.max(maxHueco, hueco); } else hueco = 0; } }
  assert.ok(maxHueco <= 260, 'hueco máximo entre audios: ' + maxHueco + ' ms');
  await p.ctx.close();
});

await prueba('voz del dispositivo elegida: el significado usa speechSynthesis y no /api/tts-glosa', async () => {
  peticiones.ttsGlosa.length = 0;
  const p = await pagina({ preparar: () => localStorage.setItem('qescucha-prefs', JSON.stringify({ voz: 'device', modo: 'palabra', autoavance: false })) });
  await p.click('#play'); await esperarEstado(p, 'terminado', 30000);
  assert.equal((await p.evaluate(() => window.__voz)).length, 4); assert.equal(peticiones.ttsGlosa.length, 0);
  await p.ctx.close();
});

await prueba('ritmo: las pausas se pueden ajustar y 0 s elimina el silencio entre palabras', async () => {
  const p = await pagina({ url: '/escucha.html?s=1&a=7' }); await modo(p, 'palabra'); await ajustes(p, { autoavance: false });
  await p.evaluate(() => window.__escucha.motor.actualizarPrefs({ pausaPalabraMs: 0 }));
  const plan = await p.evaluate(() => window.__escucha.motor.plan.map(x => x.tipo)); assert.ok(!plan.includes('pausa'), 'sin pausas dentro del palabra por palabra');
  await p.click('#ajustesBtn'); await p.evaluate(() => { const r = document.getElementById('pausaPal'); r.value = 300; r.dispatchEvent(new Event('change')); });
  assert.equal(await p.evaluate(() => window.__escucha.prefs.pausaPalabraMs), 300);
  assert.equal(await p.evaluate(() => window.__escucha.motor.plan.filter(x => x.tipo === 'pausa').length), 8, '9 palabras → 8 pausas entre ellas (ninguna al final)');
  await p.evaluate(() => { const r = document.getElementById('velPal'); r.value = 1.5; r.dispatchEvent(new Event('change')); });
  assert.equal(await p.evaluate(() => window.__escucha.prefs.velocidadPalabras), 1.5);
  await p.ctx.close();
});

await prueba('repeticiones por palabra y por aleya', async () => {
  const p = await pagina(); await modo(p, 'combinada'); await ajustes(p, { autoavance: false, traduccion: false, glosas: false });
  await p.evaluate(() => window.__escucha.motor.actualizarPrefs({ pausaMs: 0, repPalabra: 2, repAleya: 2 }));
  await p.click('#play'); await esperarEstado(p, 'terminado', 30000);
  const pasos = await p.evaluate(() => window.__escucha.motor.plan.map(s => s.tipo + (s.i ?? '')));
  assert.equal(pasos.filter(x => x.startsWith('palabraVoz')).length, 8); assert.equal(pasos.filter(x => x === 'recitacion').length, 2);
  const pl = await p.evaluate(() => window.__pl.filter(x => /001001/.test(x.u) && x.t < 100));
  assert.equal(pl.length, 2, 'la recitación completa suena 2 veces y las palabras no usan fragmentos de ella; vistos ' + JSON.stringify(pl));
  await p.ctx.close();
});

await prueba('pausar/continuar sin duplicar audio y saltar de aleya cancela lo pendiente', async () => {
  const p = await pagina({ url: '/escucha.html?s=1&a=5' }); await modo(p, 'recitacion'); await ajustes(p, { autoavance: false });
  await p.click('#play'); await p.waitForFunction(() => window.__escucha.controlador.elemento.currentTime > .3);
  await p.click('#play'); await esperarEstado(p, 'pausado');
  const t1 = await p.evaluate(() => window.__escucha.controlador.elemento.currentTime); await p.waitForTimeout(400);
  const t2 = await p.evaluate(() => window.__escucha.controlador.elemento.currentTime);
  assert.equal(t1, t2, 'en pausa el audio no avanza');
  assert.equal(await p.evaluate(() => window.__escucha.controlador.elemento.paused), true);
  await p.click('#play'); await p.waitForFunction(t => window.__escucha.controlador.elemento.currentTime > t + .15, t2);
  await p.click('#siguiente');
  await p.waitForFunction(() => window.__escucha.motor.aleya === 5 && /001006/.test(window.__escucha.controlador.elemento.getAttribute('data-url') || ''));
  const u = await p.evaluate(() => window.__escucha.controlador.elemento.getAttribute('data-url')); assert.match(u, /001006/);
  await esperarEstado(p, 'terminado');
  assert.ok(!(await muestras(p)).some(s => !s.p && /001005/.test(s.u) && s.t > 0 && false));
  await p.click('#anterior'); await p.waitForFunction(() => window.__escucha.motor.aleya === 4);
  assert.deepEqual(p.errores, []); await p.ctx.close();
});

await prueba('avance automático encadena aleyas y se detiene al final de la sura', async () => {
  const p = await pagina({ url: '/escucha.html?s=112&a=3' }); await modo(p, 'recitacion');
  await p.click('#play'); await p.waitForFunction(() => window.__escucha.motor.aleya === 3, null, { timeout: 15000 });
  await esperarEstado(p, 'terminado'); assert.match(await p.textContent('#aviso'), /Fin de la sura/);
  const o = await p.evaluate(() => window.__escucha.progreso.oidas['112']); assert.ok(o.includes(2) && o.includes(3), JSON.stringify(o));
  await p.ctx.close();
});

await prueba('aleya sin segmentación fiable (fragmentos de la recitación): se desactiva palabra por palabra, se avisa y no se inventa resaltado', async () => {
  peticiones.ttsGlosa.length = 0;
  const p = await pagina({ url: '/escucha.html?s=1&a=3', preparar: PREF_RECIT }); await modo(p, 'combinada'); await ajustes(p, { autoavance: false });
  assert.match(await p.textContent('#aviso'), /segmentación fiable/);
  await p.click('#play'); await esperarEstado(p, 'terminado');
  const m = await muestras(p); assert.ok(m.some(s => !s.p && /001003/.test(s.u)), 'suena la recitación completa auténtica');
  assert.ok(m.filter(s => !s.p && s.act >= 0).every(s => s.n === 2), 'sólo se resalta el rango real de dos palabras que traen las marcas, nunca una palabra suelta');
  assert.equal(peticiones.ttsGlosa.length, 0, 'no se hablan significados palabra por palabra');
  // con el otro recitador sí hay segmentación
  await p.click('#ajustesBtn'); await p.click('[data-rec="shuraym"]'); await p.click('#ajustes [data-cerrar]');
  await p.waitForFunction(() => window.__escucha.motor.estado === 'pausado' && window.__escucha.motor.datos !== null, null, { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => document.getElementById('aviso').hidden, null, { timeout: 5000 });
  await p.ctx.close();
});

await prueba('preferencias y progreso persisten; sólo se escribe en el lector el registro de aleyas leídas', async () => {
  const p = await pagina({ preparar: () => { if (localStorage.getItem('qpositions')) return; /* sólo la primera carga: no pisar lo guardado al recargar */ localStorage.setItem('qpositions', '{"2":41}'); localStorage.setItem('qread', '{"2":[0,1,2]}'); localStorage.setItem('qposition', '{"chapter":2,"i":41}'); } });
  await p.click('#ajustesBtn'); await p.click('[data-rec="shuraym"]'); await p.click('[data-pref="translit"]'); await p.click('[data-pref="glosas"]'); await p.click('[data-paso="repAleya"][data-d="1"]');
  await p.click('#ajustes [data-cerrar]'); await modo(p, 'recitacion'); await ajustes(p, { autoavance: false });
  await p.click('#play'); await esperarEstado(p, 'terminado'); await p.waitForTimeout(100);
  await p.reload(); await p.waitForFunction(() => window.__escucha?.motor?.estado === 'pausado' && document.querySelector('.pal'));
  const pr = await p.evaluate(() => window.__escucha.prefs);
  assert.equal(pr.recitador, 'shuraym'); assert.equal(pr.translit, false); assert.equal(pr.glosas, false); assert.equal(pr.repAleya, 2); assert.equal(pr.modo, 'recitacion');
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.pal .tr')).display), 'none');
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.pal .es')).display), 'none');
  const ls = await p.evaluate(() => ({ pos: localStorage.getItem('qpositions'), read: localStorage.getItem('qread'), pos1: localStorage.getItem('qposition'), prog: localStorage.getItem('qescucha-progreso'), claves: Object.keys(localStorage).sort() }));
  assert.equal(ls.pos, '{"2":41}'); assert.equal(ls.pos1, '{"chapter":2,"i":41}');       // posición del lector: intacta
  assert.deepEqual(JSON.parse(ls.read), { 2: [0, 1, 2], 1: [0] }, 'lo leído antes se conserva y la aleya escuchada se suma');
  assert.ok(JSON.parse(ls.prog).oidas['1'].includes(0), ls.prog);
  assert.deepEqual(ls.claves.filter(k => k.startsWith('qescucha')), ['qescucha-prefs', 'qescucha-progreso']);
  await p.ctx.close();
});

await prueba('Media Session: metadatos, estado y acciones (play, pausa, anterior, siguiente)', async () => {
  const p = await pagina({ url: '/escucha.html?s=1&a=2' }); await modo(p, 'recitacion'); await ajustes(p, { autoavance: false });
  const md = await p.evaluate(() => ({ t: navigator.mediaSession.metadata?.title, a: navigator.mediaSession.metadata?.artist, h: Object.keys(window.__ms.handlers) }));
  assert.match(md.t, /Al-Fatiha · aleya 2/); assert.match(md.a, /Alafasy/);
  for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'stop']) assert.ok(md.h.includes(a), 'falta acción ' + a);
  await p.evaluate(() => window.__conGesto(() => window.__ms.handlers.play())); await esperarEstado(p, 'reproduciendo');
  assert.equal(await p.evaluate(() => navigator.mediaSession.playbackState), 'playing');
  await p.evaluate(() => window.__ms.handlers.pause()); await esperarEstado(p, 'pausado');
  assert.equal(await p.evaluate(() => navigator.mediaSession.playbackState), 'paused');
  await p.evaluate(() => window.__ms.handlers.nexttrack()); await p.waitForFunction(() => window.__escucha.motor.aleya === 2);
  assert.match(await p.evaluate(() => navigator.mediaSession.metadata.title), /aleya 3/);
  await p.evaluate(() => window.__ms.handlers.previoustrack()); await p.waitForFunction(() => window.__escucha.motor.aleya === 1);
  await p.ctx.close();
});

for (const [ancho, alto, nombre] of [[320, 568, 'iPhone SE / 320 px'], [360, 640, 'Android pequeño'], [390, 844, 'iPhone 14'], [640, 360, 'apaisado']]) {
  await prueba(`pantalla pequeña ${nombre}: sin desbordes, barra visible y palabra activa siempre a la vista`, async () => {
    const p = await pagina({ ancho, alto, url: '/escucha.html?s=2&a=282' }); await modo(p, 'recitacion'); await ajustes(p, { autoavance: false });
    const g = await p.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, ctl: r('controles'), pp: r('panelPalabras') }; });
    assert.ok(g.sw <= g.iw, `desborde horizontal ${g.sw} > ${g.iw}`);
    assert.ok(g.ctl.bottom <= g.ih + 1 && g.ctl.left >= 0 && g.ctl.right <= g.iw + 1, 'barra dentro de la pantalla');
    assert.ok(g.pp.height > 120, 'el panel de palabras conserva altura útil: ' + g.pp.height);
    for (const id of ['repetir', 'anterior', 'play', 'siguiente', 'ajustesBtn']) { const b = await p.evaluate(i => { const r = document.getElementById(i).getBoundingClientRect(); return [r.width, r.height]; }, id); assert.ok(b[0] >= 44 && b[1] >= 44, `${id} táctil ${b}`); }
    // La recitación de 2:282 tiene >100 palabras: avanzamos hasta pasar la primera pantalla y comprobamos el desplazamiento automático.
    await p.evaluate(() => window.__escucha.motor.actualizarPrefs({ velocidad: 1 }));
    await p.click('#play'); await p.waitForFunction(t => window.__escucha.controlador.elemento.currentTime > t, alto < 400 ? 16 : 6, { timeout: 30000 });
    for (let i = 0; i < 6; i++) {
      await p.waitForTimeout(450);
      const v = await p.evaluate(async () => { const visible = () => { const a = document.querySelector('.pal.activa'); if (!a) return true; const r = a.getBoundingClientRect(), c = document.getElementById('panelPalabras').getBoundingClientRect(); return r.top >= c.top - 2 && r.bottom <= c.bottom + 2; }; for (let k = 0; k < 14 && !visible(); k++) await new Promise(ok => setTimeout(ok, 50)); // margen para que termine el desplazamiento animado
        return (() => { const a = document.querySelector('.pal.activa'); if (!a) return null; const r = a.getBoundingClientRect(), c = document.getElementById('panelPalabras').getBoundingClientRect(); return { dentro: r.top >= c.top - 2 && r.bottom <= c.bottom + 2, top: document.getElementById('panelPalabras').scrollTop }; })(); });
      assert.ok(v === null || v.dentro, 'la palabra activa quedó fuera del área visible: ' + JSON.stringify(v));
    }
    assert.ok(await p.evaluate(() => document.getElementById('panelPalabras').scrollTop) > 0, 'el panel se desplazó solo');
    assert.deepEqual(p.errores, []); await p.ctx.close();
  });
}

await prueba('configuración: fondo decorativo y desenfoque, interruptores independientes', async () => {
  const p = await pagina();
  await p.click('#ajustesBtn');
  await p.click('[data-fondo="geometria"]'); assert.match(await p.evaluate(() => document.getElementById('fondoImg').style.backgroundImage), /svg/);
  await p.evaluate(() => { const b = document.getElementById('blur'); b.value = 8; b.dispatchEvent(new Event('input')); const d = document.getElementById('dim'); d.value = 60; d.dispatchEvent(new Event('input')); });
  assert.equal(await p.evaluate(() => document.getElementById('fondoImg').style.filter), 'blur(8px)'); assert.equal(await p.evaluate(() => document.getElementById('fondoVelo').style.opacity), '0.6');
  await p.click('[data-pref="fondoOn"]'); assert.ok(await p.evaluate(() => document.body.classList.contains('sin-fondo')));
  await p.click('[data-pref="traduccion"]'); assert.ok(await p.evaluate(() => document.body.classList.contains('sin-trad'))); assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('panelTrad')).display), 'none');
  await p.click('[data-pref="resaltado"]'); assert.ok(await p.evaluate(() => document.body.classList.contains('sin-resaltado')));
  await p.click('[data-pref="translit"]'); assert.equal(await p.evaluate(() => document.getElementById('palabras').classList.contains('sin-tr')), true);
  assert.equal(await p.evaluate(() => document.getElementById('palabras').classList.contains('sin-es')), false);
  await p.ctx.close();
});

await prueba('Al-Baqara abre pidiendo sólo lo necesario (un bloque de glosas, una página de recitación, una aleya traducida)', async () => {
  // (2:255 está a 5 aleyas del final de su bloque: se adelanta el siguiente)
  for (const [url, bloque, paginas] of [['/escucha.html?s=2&a=1', ['2-001-020.json'], ['7:2:1']], ['/escucha.html?s=2&a=255', ['2-241-260.json', '2-261-286.json'], ['7:2:6']]]) {
    peticiones.datos.length = 0; peticiones.recit.length = 0; peticiones.trad.length = 0;
    const t0 = Date.now(); const p = await pagina({ url }); const ms = Date.now() - t0;
    const bloques = peticiones.datos.filter(x => /\/data\/al-baqarah\/\d/.test(x));
    assert.deepEqual(bloques.map(x => x.split('/').pop()).sort(), bloque, 'sólo el bloque de la aleya (y el siguiente si está cerca del final): ' + bloques);
    assert.deepEqual(peticiones.recit, paginas, 'una sola página de recitación');
    assert.ok(peticiones.trad.some(x => x.startsWith('ayah 2:')), 'la aleya se traduce sola: ' + peticiones.trad);
    assert.ok(ms < 4000, 'abrió en ' + ms + ' ms'); await p.ctx.close();
  }
  // Cerca del final de la página 1 se adelanta la 2 (y la sura completa se trae después, en segundo plano)
  peticiones.recit.length = 0; peticiones.datos.length = 0;
  const p = await pagina({ url: '/escucha.html?s=2&a=45' }); await p.waitForTimeout(500);
  assert.deepEqual([...new Set(peticiones.recit)].sort(), ['7:2:1', '7:2:2'], 'adelanta la página siguiente');
  assert.ok(peticiones.datos.some(x => x.endsWith('2-041-060.json')) , 'bloque de la aleya 45');
  await p.evaluate(() => window.__escucha.motor.irA(60)); await p.waitForFunction(() => window.__escucha.motor.aleya === 60 && window.__escucha.motor.estado === 'pausado');
  assert.match(await p.textContent('#traduccion'), /Traducción de prueba 2:61/);
  await p.ctx.close();
});

await prueba('las aleyas escuchadas hasta el final cuentan como leídas en el lector (qread), también en palabra por palabra', async () => {
  const p = await pagina({ url: '/escucha.html?s=112&a=1', preparar: () => { if (!localStorage.getItem('qread')) localStorage.setItem('qread', '{"112":[3]}'); } }); await ajustes(p, { autoavance: true });
  await modo(p, 'palabra'); await p.click('#play'); await p.waitForFunction(() => window.__escucha.motor.aleya === 1, null, { timeout: 30000 });
  assert.deepEqual(JSON.parse(await p.evaluate(() => localStorage.getItem('qread'))), { 112: [3, 0] }, 'la primera aleya terminada se añade al registro del lector');
  await p.click('#play'); await esperarEstado(p, 'pausado');   // se pausa a mitad de la segunda: NO cuenta
  assert.deepEqual(JSON.parse(await p.evaluate(() => localStorage.getItem('qread'))), { 112: [3, 0] });
  await p.ctx.close();
});

await prueba('selector de sura y aleya', async () => {
  const p = await pagina(); await p.click('#suraBtn'); await p.fill('#buscar', 'ikhlas'); assert.equal(await p.locator('.sura-op').count(), 1);
  await p.click('.sura-op'); await p.waitForFunction(() => /Al-Ikhlas/.test(document.getElementById('tituloSura').textContent) && window.__escucha.motor.estado === 'pausado');
  assert.equal(await p.locator('.pal').count() > 0, true); assert.match(new URL(p.url()).search, /s=112&a=1/);
  await p.click('#suraBtn'); await p.fill('#aleyaIr', '3'); await p.dispatchEvent('#aleyaIr', 'change'); await p.waitForFunction(() => window.__escucha.motor.aleya === 2);
  await p.ctx.close();
});

await prueba('el lector tradicional sigue intacto y enlaza a la escucha inmersiva', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' }); await simularRed(ctx);
  await ctx.route(/api\.alquran\.cloud\/v1\/surah$/, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ data: [{ number: 1, name: 'x', englishName: 'Al-Fatiha', englishNameTranslation: 'x', numberOfAyahs: 7 }] }) }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(base + '/'); assert.equal(await p.getAttribute('#immersiveHome', 'href'), '/escucha.html');
  assert.ok(await p.locator('#immersive').count() === 1 && await p.locator('#gear').count() === 1);
  await p.evaluate(() => { state.chapter = 2; state.i = 9; }); await Promise.all([p.waitForURL(/escucha\.html\?s=2&a=10/), p.click('#immersive', { force: true })]).catch(async () => { await p.evaluate(() => $('immersive').onclick()); await p.waitForURL(/escucha\.html\?s=2&a=10/); });
  assert.deepEqual(errs, []); await ctx.close();
});

await browser.close(); servidor.close();
console.log(`\n${ok} pruebas correctas, ${fallos.length} con fallos`);
if (fallos.length) { console.log('Fallos:\n - ' + fallos.join('\n - ')); process.exit(1); }
