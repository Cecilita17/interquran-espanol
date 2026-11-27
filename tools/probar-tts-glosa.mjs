#!/usr/bin/env node
// Pruebas de api/tts-glosa.js con servicios simulados.   node --test tools/probar-tts-glosa.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, limpiar } from '../api/tts-glosa.js';
import { VOICES } from '../api/tts.js';

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; } }; return r; };
const q = (o = {}) => ({ query: { s: '1', a: '1', w: '1', v: VOICES[0], ...o } });

test('tts-glosa: glosa válida → mp3 con la voz pedida', async () => {
  let pedido; const h = createHandler({ getGlosa: async () => 'en el nombre de', speak: async (t, v) => { pedido = [t, v]; return { audio: [1, 2] }; } });
  const r = res(); await h(q(), r);
  assert.equal(r.code, 200); assert.equal(r.headers['Content-Type'], 'audio/mpeg'); assert.deepEqual(pedido, ['en el nombre de', VOICES[0]]);
});
test('tts-glosa: parámetros o voz inválidos → 400 sin llamar a nada', async () => {
  let n = 0; const h = createHandler({ getGlosa: async () => { n++; return 'x'; }, speak: async () => { n++; return { audio: [1] }; } });
  for (const o of [{ s: '0' }, { a: '0' }, { w: '0' }, { w: 'x' }, { v: 'ar-SA-HamedNeural' }, { v: undefined }]) { const r = res(); await h(q(o), r); assert.equal(r.code, 400, JSON.stringify(o)); }
  assert.equal(n, 0);
});
test('tts-glosa: el texto lo decide el servidor, no un parámetro del cliente', async () => {
  let dicho; const h = createHandler({ getGlosa: async () => 'Alá', speak: async t => { dicho = t; return { audio: [1] }; } });
  const r = res(); await h(q({ text: 'otra cosa' }), r); assert.equal(dicho, 'Alá');
});
test('tts-glosa: sin glosa, placeholder o muy larga → 422; fallo del servicio → 503', async () => {
  for (const t of ['', '—', 'x'.repeat(200)]) { const r = res(); await createHandler({ getGlosa: async () => t, speak: async () => ({ audio: [1] }) })(q(), r); assert.equal(r.code, 422, t.slice(0, 5)); }
  const r = res(); await createHandler({ getGlosa: async () => { throw new Error('x'); } })(q(), r); assert.equal(r.code, 503); assert.equal(r.headers['Cache-Control'], 'no-store');
});
test('tts-glosa: limpieza de marcas de duda', () => { assert.equal(limpiar('el libro [? revisar]'), 'el libro'); assert.equal(limpiar(' a  b '), 'a b'); });

test('tts-glosa: encuentra la glosa real en el glosario publicado (bloques de varias suras)', async () => {
  const http = await import('node:http'), fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
  const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const srv = http.createServer((rq, rs) => { const f = path.join(root, new URL(rq.url, 'http://x').pathname); if (!f.startsWith(root) || !fs.existsSync(f)) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { 'Content-Type': 'application/json' }); fs.createReadStream(f).pipe(rs); }).listen(0);
  process.env.GLOSAS_ORIGEN = `http://127.0.0.1:${srv.address().port}`;
  try {
    const mod = await import('../api/tts-glosa.js?real=' + Date.now());
    const dichos = []; const h = mod.createHandler({ speak: async t => { dichos.push(t); return { audio: [1] }; } });
    for (const [s, a, w] of [[1, 1, 2], [2, 255, 1], [2, 282, 30], [18, 10, 3], [114, 6, 1]]) { const r = res(); await h(q({ s: String(s), a: String(a), w: String(w) }), r); assert.equal(r.code, 200, `${s}:${a}:${w}`); }
    assert.equal(dichos[0], 'Alá'); assert.ok(dichos.every(t => t.length > 0 && !t.includes('[?')), JSON.stringify(dichos));
    const r = res(); await h(q({ s: '1', a: '1', w: '99' }), r); assert.equal(r.code, 422);   // palabra inexistente
  } finally { srv.close(); delete process.env.GLOSAS_ORIGEN; }
});
