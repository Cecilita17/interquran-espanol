#!/usr/bin/env node
// Pruebas del motor de «Escucha inmersiva» (máquina de estados) y de la validación de marcas
// de tiempo, con un controlador de audio simulado y reloj virtual. Sin red ni navegador.
//   node --test tools/probar-motor.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { construirPlan, crearMotor, MODOS } from '../escucha/motor.js';
import { evaluarSegmentos, palabraActiva, COLA_MS } from '../escucha/segmentos.js';

const ale = (o = {}) => ({ clave: '1:1', nPalabras: 3, traduccionDisponible: true, palabrasFiables: true, palabrasVoz: true, urlsPalabra: ['a1', 'a2', 'a3'], palabras: [{ ar: 'أ' }, { ar: 'ب' }, { ar: 'ت' }], recitacionDisponible: true,
  traduccion: 'Texto', significados: ['a', 'b', 'c'], clips: [{ ini: 0, fin: 500 }, { ini: 510, fin: 900 }, { ini: 910, fin: 1500 }],
  rangos: [{ desde: 0, hasta: 1, ini: 0, fin: 500 }, { desde: 1, hasta: 2, ini: 510, fin: 900 }, { desde: 2, hasta: 3, ini: 910, fin: 1400 }],
  urlAudio: 'x.mp3', urlsAlt: [], ...o });
const tipos = plan => plan.pasos.map(p => p.tipo === 'palabra' ? 'P' + p.i : p.tipo === 'palabraVoz' ? 'A' + p.i : p.tipo === 'significado' ? 'S' + p.i : p.tipo === 'recitacion' ? 'R' : p.tipo === 'traduccion' ? 'T' : '_').join(' ');

test('plan: los cuatro modos', () => {
  const base = { pausaMs: 0 };
  assert.equal(tipos(construirPlan(ale(), { ...base, modo: MODOS.TRADUCCION_RECITACION })), 'T R');
  assert.equal(tipos(construirPlan(ale(), { ...base, modo: MODOS.PALABRA })), 'S0 A0 S1 A1 S2 A2');
  assert.equal(tipos(construirPlan(ale(), { ...base, modo: MODOS.COMBINADA })), 'T S0 A0 S1 A1 S2 A2 R');
  assert.equal(tipos(construirPlan(ale(), { ...base, modo: MODOS.RECITACION })), 'R');
});
test('plan: pausas entre audios y ninguna al final', () => {
  const p = construirPlan(ale(), { modo: MODOS.TRADUCCION_RECITACION, pausaMs: 700 });
  assert.equal(tipos(p), 'T _ R');
  assert.equal(p.pasos[1].ms, 700);
  assert.ok(!tipos(construirPlan(ale(), { modo: MODOS.COMBINADA, pausaMs: 300 })).endsWith('_'));
});
test('plan: repeticiones por palabra y por aleya', () => {
  const p = construirPlan(ale(), { modo: MODOS.COMBINADA, pausaMs: 0, repPalabra: 2, repAleya: 3 });
  assert.equal(p.pasos.filter(s => s.tipo === 'palabraVoz').length, 6);
  assert.equal(p.pasos.filter(s => s.tipo === 'recitacion').length, 3);
  assert.equal(p.pasos.filter(s => s.tipo === 'traduccion').length, 1);
  const q = construirPlan(ale(), { modo: MODOS.PALABRA, pausaMs: 0, repAleya: 2 });
  assert.equal(q.pasos.filter(s => s.tipo === 'palabraVoz').length, 6); // el recorrido completo se repite
});
test('plan: interruptores de traducción y glosas', () => {
  assert.equal(tipos(construirPlan(ale(), { modo: MODOS.COMBINADA, pausaMs: 0, traduccion: false, glosas: false })), 'A0 A1 A2 R');
});
test('plan: con voz neuronal no hace falta segmentación; con fragmentos de la recitación sí (y se avisa)', () => {
  const sinMarcas = ale({ palabrasFiables: false });
  assert.equal(tipos(construirPlan(sinMarcas, { modo: MODOS.COMBINADA, pausaMs: 0 })), 'T S0 A0 S1 A1 S2 A2 R'); // voz: funciona en toda aleya
  const c = construirPlan(sinMarcas, { modo: MODOS.COMBINADA, pausaMs: 0, fuentePalabra: 'recitacion' });
  assert.equal(tipos(c), 'T R'); assert.equal(c.avisos.length, 1);
  const p = construirPlan(sinMarcas, { modo: MODOS.PALABRA, pausaMs: 0, fuentePalabra: 'recitacion' });
  assert.equal(tipos(p), 'R'); assert.match(p.avisos[0], /segmentación fiable/);
  assert.equal(tipos(construirPlan(ale(), { modo: MODOS.PALABRA, pausaMs: 0, fuentePalabra: 'recitacion' })), 'S0 P0 S1 P1 S2 P2');
});
test('plan: sin voz árabe disponible se desactiva palabra por palabra y se avisa', () => {
  const p = construirPlan(ale({ palabrasVoz: false }), { modo: MODOS.COMBINADA, pausaMs: 0 });
  assert.equal(tipos(p), 'T R'); assert.match(p.avisos[0], /Voz árabe no disponible/);
});
test('plan: sin audio de recitación no se inventa nada', () => {
  const p = construirPlan(ale({ recitacionDisponible: false }), { modo: MODOS.RECITACION, pausaMs: 0 });
  assert.equal(p.pasos.length, 0); assert.equal(p.avisos.length, 1);
});

test('segmentos: validación estricta', () => {
  const ok = [[0, 1, 60, 610], [1, 2, 620, 1310], [2, 3, 1320, 2450]];
  const e = evaluarSegmentos(ok, 3);
  assert.ok(e.fiable); assert.equal(e.porPalabra[0].fin, 610 + 10); // llega hasta la siguiente palabra: 620 < 610 + COLA
  assert.ok(e.porPalabra[0].fin <= 620);
  assert.equal(e.porPalabra[2].fin, 2450 + COLA_MS);
  assert.ok(!evaluarSegmentos(ok, 4).fiable);                       // faltan palabras
  assert.ok(!evaluarSegmentos([[0, 2, 0, 500], [2, 3, 510, 900]], 3).fiable); // agrupa
  assert.ok(evaluarSegmentos([[0, 2, 0, 500], [2, 3, 510, 900]], 3).rangos);   // pero sirve para resaltar
  assert.ok(!evaluarSegmentos([[0, 1, 0, 500], [2, 3, 510, 900]], 3).rangos);  // salto
  assert.ok(!evaluarSegmentos([[0, 1, 500, 900], [1, 2, 100, 200]], 2).rangos); // tiempo retrocede
  assert.ok(!evaluarSegmentos([], 3).fiable);
  assert.ok(!evaluarSegmentos(null, 3).fiable);
  assert.ok(!evaluarSegmentos([[0, 1, 'a', 3]], 1).fiable);
});
test('segmentos: la cola nunca invade la palabra siguiente', () => {
  const e = evaluarSegmentos([[0, 1, 0, 100], [1, 2, 150, 400]], 2);
  assert.equal(e.porPalabra[0].fin, 150);
});
test('segmentos: palabra activa según marcas reales', () => {
  const r = evaluarSegmentos([[0, 1, 100, 500], [1, 2, 600, 900]], 2).rangos;
  assert.equal(palabraActiva(r, 50), null);
  assert.deepEqual(palabraActiva(r, 100), { desde: 0, hasta: 1 });
  assert.deepEqual(palabraActiva(r, 550), { desde: 0, hasta: 1 }); // silencio: se mantiene la anterior
  assert.deepEqual(palabraActiva(r, 600), { desde: 1, hasta: 2 });
  assert.equal(palabraActiva(r, 900), null);
});

// ---- Motor con controlador simulado ------------------------------------------------------------
function entorno({ total = 3, datos = i => ale({ clave: '1:' + (i + 1) }), prefs = {} } = {}) {
  let ahora = 0, nTimer = 0; const timers = new Map();
  const temporizador = { set: (f, ms) => { const id = ++nTimer; timers.set(id, { f, t: ahora + ms }); return id; }, clear: id => timers.delete(id) };
  const orig = Date.now; Date.now = () => ahora;
  const adelantar = ms => { const fin = ahora + ms; for (;;) { const s = [...timers].sort((a, b) => a[1].t - b[1].t)[0]; if (!s || s[1].t > fin) break; ahora = s[1].t; timers.delete(s[0]); s[1].f(); } ahora = fin; };
  const log = [], eventos = []; let activa = null, maxSimultaneas = 0, pausado = false;
  const op = (nombre, d) => new Promise(res => {
    if (activa) log.push('SOLAPE:' + nombre);
    const o = { nombre, d, res }; activa = o; log.push(nombre); maxSimultaneas = Math.max(maxSimultaneas, 1);
    if (d.alTiempo) o.alTiempo = d.alTiempo;
  });
  const controlador = {
    reproducirClip: d => op(`clip:${d.desdeMs}-${d.hastaMs}`, d),
    hablar: d => op(d.lang === 'ar-SA' ? 'arabe:' + d.url : 'traduccion', d), hablarLocal: d => op('significado:' + d.texto, d),
    pausar() { pausado = true; log.push('pausar'); }, reanudar() { pausado = false; log.push('reanudar'); },
    cancelar() { if (activa) { const a = activa; activa = null; log.push('cancelar:' + a.nombre); a.res('cancelado'); } }
  };
  const terminar = (r = 'ok') => { const a = activa; assert.ok(a, 'no hay audio activo'); activa = null; a.res(r); };
  const asentar = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const motor = crearMotor({ controlador, total, obtenerAleya: async i => datos(i), alEvento: e => eventos.push(e), temporizador, prefs: { pausaMs: 0, ...prefs } });
  return { motor, log, eventos, terminar, asentar, adelantar, get activa() { return activa; }, get pausado() { return pausado; }, restaurar: () => { Date.now = orig; } };
}

test('motor: ejecuta el plan paso a paso sin solapes', async () => {
  const e = entorno({ prefs: { modo: MODOS.COMBINADA, autoavance: false, fuentePalabra: 'recitacion' } });
  await e.motor.reproducir(0); await e.asentar();
  for (let k = 0; k < 8; k++) { await e.terminar(); await e.asentar(); }
  assert.deepEqual(e.log.filter(x => !x.startsWith('cancelar')), ['traduccion', 'significado:a', 'clip:0-500', 'significado:b', 'clip:510-900', 'significado:c', 'clip:910-1500', 'clip:0-null']);
  assert.equal(e.motor.estado, 'terminado'); assert.ok(!e.log.some(x => x.startsWith('SOLAPE')));
  e.restaurar();
});
test('motor: pausa y continúa sin avanzar ni repetir', async () => {
  const e = entorno({ prefs: { modo: MODOS.TRADUCCION_RECITACION, autoavance: false } });
  await e.motor.reproducir(0); await e.asentar();
  e.motor.pausar(); assert.equal(e.motor.estado, 'pausado'); assert.ok(e.pausado);
  await e.asentar(); assert.deepEqual(e.log, ['traduccion', 'pausar']);
  e.motor.reanudar(); assert.equal(e.motor.estado, 'reproduciendo'); assert.ok(!e.pausado);
  e.terminar(); await e.asentar(); assert.equal(e.log.at(-1), 'clip:0-null');
  e.restaurar();
});
test('motor: pausa durante un silencio conserva el tiempo restante', async () => {
  const e = entorno({ prefs: { modo: MODOS.TRADUCCION_RECITACION, autoavance: false, pausaMs: 1000 } });
  await e.motor.reproducir(0); await e.asentar(); e.terminar(); await e.asentar();
  e.adelantar(400); e.motor.pausar(); e.adelantar(5000); await e.asentar();
  assert.ok(!e.log.includes('clip:0-null'));
  e.motor.reanudar(); e.adelantar(500); await e.asentar(); assert.ok(!e.log.includes('clip:0-null'));
  e.adelantar(200); await e.asentar(); assert.equal(e.log.at(-1), 'clip:0-null');
  e.restaurar();
});
test('motor: saltar de aleya cancela el audio pendiente y el viejo no avanza el plan nuevo', async () => {
  const e = entorno({ prefs: { modo: MODOS.TRADUCCION_RECITACION, autoavance: false } });
  await e.motor.reproducir(0); await e.asentar();
  const antes = e.log.length;
  e.motor.siguiente(); await e.asentar();
  assert.equal(e.motor.aleya, 1); assert.equal(e.log[antes], 'cancelar:traduccion'); assert.equal(e.log[antes + 1], 'traduccion');
  assert.ok(!e.log.some(x => x.startsWith('SOLAPE')));
  e.terminar(); await e.asentar(); assert.equal(e.motor.paso, 1);
  e.motor.anterior(); await e.asentar(); assert.equal(e.motor.aleya, 0); assert.equal(e.motor.paso, 0);
  e.restaurar();
});
test('motor: cargar no reproduce y avance automático encadena aleyas', async () => {
  const e = entorno({ prefs: { modo: MODOS.RECITACION, autoavance: true } });
  await e.motor.cargar(1); await e.asentar(); assert.equal(e.motor.estado, 'pausado'); assert.deepEqual(e.log, []);
  await e.motor.reproducir(); await e.asentar();
  e.terminar(); await e.asentar(); assert.equal(e.motor.aleya, 2); assert.equal(e.eventos.filter(x => x.tipo === 'escuchada').length, 1);
  e.terminar(); await e.asentar(); assert.equal(e.motor.estado, 'terminado'); assert.ok(e.eventos.some(x => x.tipo === 'fin' && x.finSura));
  e.restaurar();
});
test('motor: sin avance automático se detiene al terminar la aleya', async () => {
  const e = entorno({ prefs: { modo: MODOS.RECITACION, autoavance: false } });
  await e.motor.reproducir(0); await e.asentar(); e.terminar(); await e.asentar();
  assert.equal(e.motor.estado, 'terminado'); assert.equal(e.motor.aleya, 0);
  e.restaurar();
});
test('motor: audio bloqueado pausa y reintenta el mismo paso', async () => {
  const e = entorno({ prefs: { modo: MODOS.RECITACION, autoavance: false } });
  await e.motor.reproducir(0); await e.asentar(); e.terminar('bloqueado'); await e.asentar();
  assert.equal(e.motor.estado, 'pausado'); assert.ok(e.eventos.some(x => x.tipo === 'aviso'));
  e.motor.reanudar(); await e.asentar();
  assert.equal(e.log.filter(x => x === 'clip:0-null').length, 2); assert.equal(e.motor.estado, 'reproduciendo');
  e.restaurar();
});
test('motor: un audio con error se omite con aviso y continúa', async () => {
  const e = entorno({ prefs: { modo: MODOS.TRADUCCION_RECITACION, autoavance: false } });
  await e.motor.reproducir(0); await e.asentar(); e.terminar('error'); await e.asentar();
  assert.equal(e.log.at(-1), 'clip:0-null'); assert.ok(e.eventos.some(x => x.tipo === 'aviso' && x.paso === 'traduccion'));
  e.restaurar();
});
test('motor: cambiar de modo reinicia la aleya con el plan nuevo', async () => {
  const e = entorno({ prefs: { modo: MODOS.RECITACION, autoavance: false } });
  await e.motor.reproducir(0); await e.asentar();
  e.motor.actualizarPrefs({ modo: MODOS.PALABRA }); await e.asentar();
  assert.deepEqual(e.log.slice(-2), ['cancelar:clip:0-null', 'significado:a']);
  e.motor.actualizarPrefs({ autoavance: true }); await e.asentar(); // no cambia el plan: no reinicia
  assert.equal(e.log.at(-1), 'significado:a');
  e.restaurar();
});
test('motor: resaltado sólo con tiempos reales de la grabación', async () => {
  const e = entorno({ prefs: { modo: MODOS.RECITACION, autoavance: false } });
  await e.motor.reproducir(0); await e.asentar();
  const alTiempo = e.activa.d.alTiempo;
  alTiempo(100); alTiempo(550); alTiempo(1000); alTiempo(1450);
  const pal = e.eventos.filter(x => x.tipo === 'palabra').map(x => x.palabra && x.palabra.desde);
  assert.deepEqual(pal.slice(-4), [0, 1, 2, null]);
  e.restaurar();
});
test('motor: aleya sin marcas reproduce la recitación sin resaltar', async () => {
  const e = entorno({ datos: () => ale({ rangos: null, palabrasFiables: false, clips: null }), prefs: { modo: MODOS.RECITACION, autoavance: false } });
  await e.motor.reproducir(0); await e.asentar();
  assert.equal(e.activa.d.alTiempo, null);
  e.restaurar();
});
test('motor: fallo al cargar datos → estado error', async () => {
  const e = entorno({ datos: () => null }); await e.motor.reproducir(0); await e.asentar();
  assert.equal(e.motor.estado, 'error'); e.restaurar();
});

test('motor: tras pausar y cambiar de modo (o de aleya), play vuelve a sonar', async () => {
  for (const cambio of [m => m.actualizarPrefs({ modo: MODOS.PALABRA }), m => m.siguiente(), m => m.actualizarPrefs({ modo: MODOS.RECITACION })]) {
    const e = entorno({ prefs: { modo: MODOS.COMBINADA, autoavance: false } });
    await e.motor.reproducir(0); await e.asentar();
    e.motor.pausar(); await e.asentar();
    cambio(e.motor); await e.asentar();
    assert.equal(e.motor.estado, 'pausado');
    const antes = e.log.length;
    e.motor.alternar(); await e.asentar();           // play
    assert.equal(e.motor.estado, 'reproduciendo');
    assert.ok(e.log.length > antes && e.activa, 'debe iniciar un audio nuevo: ' + JSON.stringify(e.log.slice(antes)));
    e.restaurar();
  }
});
test('motor: tras terminar, cargar otra aleya y dar play también suena', async () => {
  const e = entorno({ prefs: { modo: MODOS.RECITACION, autoavance: false } });
  await e.motor.reproducir(0); await e.asentar(); e.terminar(); await e.asentar();
  assert.equal(e.motor.estado, 'terminado'); await e.motor.irA(1); await e.asentar();
  e.motor.alternar(); await e.asentar(); assert.ok(e.activa); assert.equal(e.motor.aleya, 1);
  e.restaurar();
});

test('motor: palabra por palabra con voz neuronal: significado → voz árabe de esa palabra, y la recitación completa al final', async () => {
  const e = entorno({ prefs: { modo: MODOS.COMBINADA, autoavance: false } });
  await e.motor.reproducir(0); await e.asentar();
  for (let k = 0; k < 8; k++) { e.terminar(); await e.asentar(); }
  assert.deepEqual(e.log.filter(x => !x.startsWith('cancelar')), ['traduccion', 'significado:a', 'arabe:a1', 'significado:b', 'arabe:a2', 'significado:c', 'arabe:a3', 'clip:0-null']);
  assert.ok(!e.log.some(x => x.startsWith('clip:') && x !== 'clip:0-null'), 'ningún fragmento de recitación suelto');
  e.restaurar();
});
