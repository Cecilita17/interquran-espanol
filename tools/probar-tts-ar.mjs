#!/usr/bin/env node
// Pruebas de api/tts-ar.js con servicios simulados (sin red).   node --test tools/probar-tts-ar.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, limpiar, VOICES_AR } from '../api/tts-ar.js';

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; } }; return r; };
const ok = { getWord: async () => 'الْحَمْدُ', speak: async () => ({ audio: new Uint8Array([1, 2, 3]) }) };

test('tts-ar: palabra válida → mp3 cacheable', async () => {
  let pedido; const h = createHandler({ ...ok, speak: async (t, v) => { pedido = [t, v]; return { audio: new Uint8Array([1, 2, 3]) }; } });
  const r = res(); await h({ query: { s: '1', a: '2', w: '1', v: VOICES_AR[0] } }, r);
  assert.equal(r.code, 200); assert.equal(r.headers['Content-Type'], 'audio/mpeg'); assert.match(r.headers['Cache-Control'], /immutable/);
  assert.deepEqual(pedido, ['الْحَمْدُ', VOICES_AR[0]]);
});
test('tts-ar: parámetros inválidos o voz fuera de la lista → 400, sin llamar a ningún servicio', async () => {
  let llamadas = 0; const h = createHandler({ getWord: async () => { llamadas++; return 'ا'; }, speak: async () => { llamadas++; return { audio: [1] }; } });
  for (const q of [{ s: '0', a: '1', w: '1', v: VOICES_AR[0] }, { s: '1', a: '1', w: '0', v: VOICES_AR[0] }, { s: '1', a: '1', w: '1', v: 'es-ES-ElviraNeural' }, { s: '1', a: '1', w: '1.5', v: VOICES_AR[0] }, { s: '115', a: '1', w: '1', v: VOICES_AR[0] }, { s: '1', a: '1', w: '1' }, {}]) {
    const r = res(); await h({ query: q }, r); assert.equal(r.code, 400, JSON.stringify(q));
  }
  assert.equal(llamadas, 0);
});
test('tts-ar: el texto lo decide el servidor (un parámetro `text` del cliente se ignora)', async () => {
  let dicho; const h = createHandler({ getWord: async () => 'رَبِّ', speak: async t => { dicho = t; return { audio: [1] }; } });
  const r = res(); await h({ query: { s: '1', a: '2', w: '3', v: VOICES_AR[1], text: 'texto arbitrario' } }, r);
  assert.equal(dicho, 'رَبِّ');
});
test('tts-ar: palabra vacía o demasiado larga → 422; fallo del servicio → 503 sin caché', async () => {
  let r = res(); await createHandler({ ...ok, getWord: async () => '' })({ query: { s: '1', a: '1', w: '9', v: VOICES_AR[0] } }, r); assert.equal(r.code, 422);
  r = res(); await createHandler({ ...ok, getWord: async () => 'ا'.repeat(80) })({ query: { s: '1', a: '1', w: '1', v: VOICES_AR[0] } }, r); assert.equal(r.code, 422);
  r = res(); await createHandler({ ...ok, speak: async () => { throw new Error('x'); } })({ query: { s: '1', a: '1', w: '1', v: VOICES_AR[0] } }, r);
  assert.equal(r.code, 503); assert.equal(r.headers['Cache-Control'], 'no-store');
});
test('tts-ar: limpieza del texto', () => {
  assert.equal(limpiar('بِسْمِ'), 'بِسْمِ'); assert.equal(limpiar('ٱلرَّحْمَٰنِ'), 'ٱلرَّحْمَٰنِ');
  assert.equal(limpiar('مِنَ<script>'), 'مِنَ'); assert.equal(limpiar('لَاـ۟'), 'لَا');
});
