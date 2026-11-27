// «Escucha inmersiva»: pantalla independiente del lector interlineal. No comparte estado con él:
// sus preferencias y su progreso se guardan en claves propias (qescucha-*).
import { crearMotor, MODOS, PREFS_MOTOR } from './motor.js';
import { crearControlador } from './audio.js';
import { cargarIndice, datosAleya, RECITADORES, VOCES, VOCES_AR } from './datos.js';
import { FONDOS, FONDO_PROPIO, guardarFondoPropio, leerFondoPropio, prepararImagen } from './fondos.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Preferencias y progreso (independientes del lector) -------------------------------------
const CLAVE_PREFS = 'qescucha-prefs', CLAVE_PROGRESO = 'qescucha-progreso';
const leer = (k, d) => { try { return { ...d, ...(JSON.parse(localStorage.getItem(k)) || {}) }; } catch (e) { return { ...d }; } };
const escribir = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* almacenamiento no disponible: se sigue sin guardar */ } };
const valorLector = (k, ok, d) => { try { const v = localStorage.getItem(k); return ok(v) ? v : d; } catch (e) { return d; } }; // sólo LEE la voz/traducción que el lector ya usa, como valor inicial

const PREFS_BASE = {
  modo: MODOS.COMBINADA, recitador: 'alafasy', repPalabra: 1, repAleya: 1, pausaMs: 150, pausaPalabraMs: 150, velocidadPalabras: 1.2, autoavance: true, velocidad: 1,
  translit: true, glosas: true, traduccion: true, resaltado: true, fondoOn: true,
  fuentePalabra: 'voz', vozArabe: VOCES_AR[0],
  fondo: 'noche', dim: 45, blur: 0,
  voz: valorLector('qvoice', v => v && VOCES.includes(v), 'es-ES-ElviraNeural'),
  edicion: valorLector('qtrans', v => v === 'es.garcia', 'es.cortes') === 'es.garcia' ? 'garcia' : 'cortes'
};
let prefs = leer(CLAVE_PREFS, PREFS_BASE);
// Migración de valores por defecto anteriores: quien nunca cambió la pausa entre bloques (0,6 s o 0,4 s de versiones previas)
// pasa al valor nuevo; cualquier otro valor elegido por la persona se respeta.
const VERSION_PREFS = 2;
if (prefs.version !== VERSION_PREFS) {
  if (prefs.pausaMs === 600 || prefs.pausaMs === 400) prefs.pausaMs = PREFS_BASE.pausaMs;
  prefs.version = VERSION_PREFS; try { localStorage.getItem(CLAVE_PREFS) !== null && localStorage.setItem(CLAVE_PREFS, JSON.stringify(prefs)); } catch (e) {}
}
let progreso = leer(CLAVE_PROGRESO, { ultima: null, oidas: {} });
const guardarPrefs = () => escribir(CLAVE_PREFS, prefs);
const guardarProgreso = () => escribir(CLAVE_PROGRESO, progreso);

const MODOS_INFO = [
  [MODOS.TRADUCCION_RECITACION, 'Traducción + recitación', 'Primero la traducción en español y después la recitación completa.'],
  [MODOS.PALABRA, 'Palabra por palabra', 'Cada palabra en árabe (audio del recitador) y su significado en español.'],
  [MODOS.COMBINADA, 'Combinada', 'Traducción, palabra por palabra y recitación completa.'],
  [MODOS.RECITACION, 'Sólo recitación', 'La recitación con las palabras resaltadas en sincronía.']
];

// ---- Estado de la pantalla ---------------------------------------------------------------------
let indice = null, sura = 1, slug = '', motor = null, avisoPlan = [], avisoTimer = 0, datosActual = null;
const controlador = crearControlador();
// La voz del dispositivo no suena de forma fiable con la pantalla bloqueada: si la página está oculta se omite el significado.
const ctl = {
  ...controlador,
  hablarLocal: o => document.hidden ? Promise.resolve('omitido') : controlador.hablarLocal(o)
};

function parametros() {
  const p = new URLSearchParams(location.search);
  const s = Math.floor(Number(p.get('s'))), a = Math.floor(Number(p.get('a')));
  if (s >= 1 && s <= 114) return { s, a: a >= 1 ? a : 1 };
  const u = progreso.ultima; if (u && u.s >= 1 && u.s <= 114) return { s: u.s, a: u.a || 1 };
  return { s: 1, a: 1 };
}

// ---- Fondo -------------------------------------------------------------------------------------
let urlFondoPropio = null;
async function aplicarFondo() {
  document.body.classList.toggle('sin-fondo', !prefs.fondoOn);
  const img = $('fondoImg');
  let css = FONDOS.find(f => f.id === prefs.fondo)?.css() || FONDOS[0].css();
  if (prefs.fondo === FONDO_PROPIO) {
    if (!urlFondoPropio) { const b = await leerFondoPropio(); if (b) urlFondoPropio = URL.createObjectURL(b); }
    css = urlFondoPropio ? `url("${urlFondoPropio}")` : FONDOS[0].css();
  }
  img.style.backgroundImage = css;
  img.style.filter = prefs.blur ? `blur(${prefs.blur}px)` : 'none';
  $('fondoVelo').style.opacity = prefs.fondoOn ? prefs.dim / 100 : 0;
}

// ---- Interfaz de la aleya ----------------------------------------------------------------------
function mostrarAviso(texto, temporal = false) {
  const el = $('aviso'); clearTimeout(avisoTimer);
  const poner = t => { el.textContent = t; el.hidden = !t; };
  poner(texto);
  if (temporal) avisoTimer = setTimeout(() => poner(avisoPlan.join(' ')), 5000);
}
function pintarAleya(d) {
  datosActual = d;
  $('palabras').innerHTML = d.palabras.map((w, i) => `<div class="pal" data-i="${i}"><span class="ar" lang="ar" dir="rtl">${esc(w.ar)}</span><span class="tr">${esc(w.tr || '')}</span><span class="es">${esc(w.es && w.es !== '—' ? w.es : '')}</span></div>`).join('');
  $('traduccion').textContent = d.traduccion || (prefs.traduccion ? 'Traducción no disponible.' : '');
  $('panelPalabras').scrollTop = 0;
  pintarSubtitulo();
}
function pintarSubtitulo(paso) {
  const n = indice[sura];
  $('tituloSura').textContent = `${n.nombre} · ${n.es}`;
  const modo = MODOS_INFO.find(m => m[0] === prefs.modo)?.[1] || '';
  $('subtitulo').textContent = `${sura}:${(motor?.aleya ?? 0) + 1} · ${paso || modo}`;
}
function etiquetaPaso(p, de, n) {
  switch (p.tipo) {
    case 'traduccion': return 'Traducción';
    case 'palabra': case 'palabraVoz': return `Palabra ${p.i + 1}/${n}`;
    case 'significado': return `Significado ${p.i + 1}/${n}`;
    case 'recitacion': return p.de > 1 ? `Recitación ${p.rep}/${p.de}` : 'Recitación';
    default: return 'Pausa';
  }
}
function resaltar(rango) {
  document.querySelectorAll('.pal.activa').forEach(e => e.classList.remove('activa'));
  if (!rango || !prefs.resaltado) return;
  let primero = null;
  for (let i = rango.desde; i < rango.hasta; i++) { const e = $('palabras').children[i]; if (e) { e.classList.add('activa'); primero ??= e; } }
  if (primero) asegurarVisible(primero);
}
// Desplazamiento automático si la palabra activa queda fuera (o pegada al borde) del área visible.
function asegurarVisible(el) {
  const c = $('panelPalabras'), r = el.getBoundingClientRect(), v = c.getBoundingClientRect(), m = 14;
  if (r.top >= v.top + m && r.bottom <= v.bottom - m) return;
  const delta = (r.top - v.top) - (v.height - r.height) / 2;
  // Animado sólo en saltos cortos: en saltos largos (o con movimiento reducido) se coloca de inmediato para que la palabra nunca quede fuera.
  const suave = Math.abs(delta) < v.height * .8 && !matchMedia('(prefers-reduced-motion:reduce)').matches;
  c.scrollTo({ top: c.scrollTop + delta, behavior: suave ? 'smooth' : 'auto' });
}
function pintarPrefsVisibles() {
  document.body.classList.toggle('sin-trad', !prefs.traduccion);
  document.body.classList.toggle('sin-resaltado', !prefs.resaltado);
  $('palabras').classList.toggle('sin-tr', !prefs.translit);
  $('palabras').classList.toggle('sin-es', !prefs.glosas);
  $('repetirN').textContent = prefs.repAleya + '×';
}

// ---- Motor ---------------------------------------------------------------------------------------
function motorPrefs() { const { modo, repPalabra, repAleya, pausaMs, pausaPalabraMs, velocidadPalabras, autoavance, traduccion, glosas, velocidad, fuentePalabra } = prefs; return { modo, repPalabra, repAleya, pausaMs, pausaPalabraMs, velocidadPalabras, autoavance, traduccion, glosas, velocidad, fuentePalabra }; }

function alEvento(ev) {
  switch (ev.tipo) {
    case 'estado': {
      const sonando = ev.estado === 'reproduciendo';
      $('playIcono').textContent = sonando ? '⏸' : '▶';
      $('play').setAttribute('aria-label', sonando ? 'Pausar' : 'Reproducir');
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = sonando ? 'playing' : (ev.estado === 'pausado' ? 'paused' : 'none');
      if (ev.estado === 'cargando') $('subtitulo').textContent = `${sura}:${motor.aleya + 1} · Cargando…`;
      if (ev.estado === 'terminado') pintarSubtitulo('Terminado');
      break;
    }
    case 'aleya': {
      pintarAleya(ev.datos); avisoPlan = ev.avisos; mostrarAviso(avisoPlan.join(' '));
      progreso.ultima = { s: sura, a: ev.aleya + 1 }; guardarProgreso();
      try { history.replaceState(null, '', `?s=${sura}&a=${ev.aleya + 1}`); } catch (e) {}
      actualizarSesionMultimedia(); $('progreso').firstElementChild.style.width = '0';
      break;
    }
    case 'paso':
      pintarSubtitulo(etiquetaPaso(ev.paso, ev.de, datosActual?.nPalabras || 0));
      $('progreso').firstElementChild.style.width = (100 * ev.indice / Math.max(1, ev.de)) + '%';
      break;
    case 'palabra': resaltar(ev.palabra); break;
    case 'escuchada': {
      const a = progreso.oidas[sura] || (progreso.oidas[sura] = []);
      if (!a.includes(ev.aleya)) { a.push(ev.aleya); guardarProgreso(); }
      $('progreso').firstElementChild.style.width = '100%';
      break;
    }
    case 'fin': mostrarAviso(ev.finSura ? 'Fin de la sura.' : 'Aleya terminada.', true); break;
    case 'aviso': mostrarAviso(ev.texto, true); break;
  }
}

function crearMotorSura(n) {
  motor?.detener();
  sura = n; slug = indice[n].slug;
  motor = crearMotor({
    controlador: ctl, total: indice[n].aleyas, prefs: motorPrefs(), alEvento,
    obtenerAleya: i => datosAleya({ sura: n, indice: i, slug, prefs })
  });
}
async function abrirSura(n, aleya = 1, reproducir = false) {
  crearMotorSura(n);
  const i = Math.max(0, Math.min(aleya - 1, indice[n].aleyas - 1));
  await (reproducir ? motor.reproducir(i) : motor.cargar(i));
}

// ---- Media Session (controles del sistema, pantalla de bloqueo, auriculares) -------------------------------
function actualizarSesionMultimedia() {
  if (!('mediaSession' in navigator) || !motor || !indice) return;
  const rec = RECITADORES.find(r => r.id === prefs.recitador)?.nombre || '';
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${indice[sura].nombre} · aleya ${motor.aleya + 1}`, artist: rec, album: 'InterQuran Español · Escucha inmersiva',
      artwork: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
    });
  } catch (e) {}
}
function registrarSesionMultimedia() {
  if (!('mediaSession' in navigator)) return;
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* acción no soportada */ } };
  h('play', () => { if (motor?.estado !== 'reproduciendo') controlador.desbloquear(); motor?.alternar(); }); h('pause', () => motor?.pausar());
  h('previoustrack', () => motor?.anterior()); h('nexttrack', () => motor?.siguiente());
  h('seekbackward', () => motor?.anterior()); h('seekforward', () => motor?.siguiente());
  h('stop', () => motor?.pausar());
}

// ---- Controles -----------------------------------------------------------------------------------------
// Todo inicio de reproducción nace de un gesto: se activa el audio dentro de él (ver controlador.desbloquear).
const alternarGesto = () => { if (motor?.estado !== 'reproduciendo') controlador.desbloquear(); motor?.alternar(); };
$('play').onclick = alternarGesto;
$('anterior').onclick = () => motor?.anterior();
$('siguiente').onclick = () => motor?.siguiente();
$('repetir').onclick = () => { const ciclo = [1, 2, 3, 5, 10]; aplicar({ repAleya: ciclo[(ciclo.indexOf(prefs.repAleya) + 1) % ciclo.length] }); };
$('suraBtn').onclick = () => abrirHoja('selector');
$('modoBtn').onclick = () => { const i = MODOS_INFO.findIndex(m => m[0] === prefs.modo); aplicar({ modo: MODOS_INFO[(i + 1) % 4][0] }); mostrarAviso(MODOS_INFO.find(m => m[0] === prefs.modo)[1], true); };
$('ajustesBtn').onclick = () => abrirHoja('ajustes');
document.addEventListener('keydown', e => {
  if (e.target.closest('input,select,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); alternarGesto(); } else if (e.key === 'ArrowRight') motor?.siguiente(); else if (e.key === 'ArrowLeft') motor?.anterior(); else if (e.key === 'Escape') cerrarHojas();
});

function abrirHoja(id) { cerrarHojas(); $(id).hidden = false; if (id === 'selector') { $('buscar').value = ''; filtrarSuras(); $('aleyaIr').max = indice[sura].aleyas; $('aleyaIr').value = (motor?.aleya ?? 0) + 1; } if (id === 'ajustes') pintarAjustes(); $(id).querySelector('button,input')?.focus?.(); }
function cerrarHojas() { document.querySelectorAll('.hoja').forEach(h => h.hidden = true); }
document.querySelectorAll('.hoja').forEach(h => h.addEventListener('click', e => { if (e.target === h || e.target.closest('[data-cerrar]')) cerrarHojas(); }));

// Aplica un cambio de preferencias: guarda, repinta y avisa al motor (que reinicia la aleya sólo si cambia el plan).
function aplicar(cambio) {
  const antes = prefs; prefs = { ...prefs, ...cambio }; guardarPrefs();
  pintarPrefsVisibles(); aplicarFondo(); if (!$('ajustes').hidden) pintarAjustes();
  motor?.actualizarPrefs(motorPrefs());
  if (cambio.recitador || cambio.edicion || cambio.voz || cambio.vozArabe) { if (cambio.recitador) actualizarSesionMultimedia(); motor?.recargarDatos(); }
  if (cambio.glosas !== undefined || cambio.traduccion !== undefined || cambio.modo) pintarSubtitulo();
  if (cambio.traduccion === false) $('traduccion').textContent = '';
  else if (cambio.traduccion === true && datosActual) $('traduccion').textContent = datosActual.traduccion || 'Traducción no disponible.';
}

// ---- Hoja de configuración -----------------------------------------------------------------------------------------
function pintarAjustes() {
  $('modos').innerHTML = MODOS_INFO.map(([id, n, d]) => `<button class="modo" role="radio" aria-checked="${prefs.modo === id}" data-modo="${id}"><b>${n}</b><small>${d}</small></button>`).join('');
  $('recitadores').innerHTML = RECITADORES.map(r => `<button class="chip" role="radio" aria-checked="${prefs.recitador === r.id}" data-rec="${r.id}">${esc(r.nombre)}</button>`).join('');
  $('repPalabraV').textContent = prefs.repPalabra; $('repAleyaV').textContent = prefs.repAleya;
  const seg = ms => (ms / 1000).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' s';
  $('pausa').value = prefs.pausaMs; $('pausaV').textContent = seg(prefs.pausaMs);
  $('pausaPal').value = prefs.pausaPalabraMs; $('pausaPalV').textContent = seg(prefs.pausaPalabraMs);
  $('velPal').value = prefs.velocidadPalabras; $('velPalV').textContent = prefs.velocidadPalabras.toLocaleString('es', { minimumFractionDigits: 1 }) + '×';
  $('vel').value = prefs.velocidad; $('velV').textContent = prefs.velocidad + '×';
  document.querySelectorAll('[data-pref]').forEach(c => c.checked = !!prefs[c.dataset.pref]);
  $('fondos').innerHTML = FONDOS.map(f => `<button class="fondo-op" role="radio" aria-checked="${prefs.fondo === f.id}" data-fondo="${f.id}" style="background-image:${f.css().replace(/"/g, '&quot;')}"><span>${f.nombre}</span></button>`).join('')
    + (urlFondoPropio ? `<button class="fondo-op" role="radio" aria-checked="${prefs.fondo === FONDO_PROPIO}" data-fondo="${FONDO_PROPIO}" style="background-image:url('${urlFondoPropio}')"><span>Mi imagen</span></button>` : '');
  $('dim').value = prefs.dim; $('dimV').textContent = prefs.dim + ' %'; $('blur').value = prefs.blur; $('blurV').textContent = prefs.blur + ' px';
  $('voz').innerHTML = VOCES.map(v => `<option value="${v}">${v === 'device' ? 'Voz del dispositivo' : v.replace('Neural', '').replace(/^es-([A-Z]{2})-/, '$1 · ')}</option>`).join(''); $('voz').value = prefs.voz;
  $('edicion').value = prefs.edicion;
  $('fuentePalabra').value = prefs.fuentePalabra;
  $('vozArabe').innerHTML = VOCES_AR.map(v => `<option value="${v}">${v.includes('Hamed') ? 'Árabe · Hamed (voz masculina)' : 'Árabe · Zariyah (voz femenina)'}</option>`).join(''); $('vozArabe').value = prefs.vozArabe;
  $('notaModo').textContent = datosActual && prefs.fuentePalabra === 'recitacion' && !datosActual.palabrasFiables && prefs.modo !== MODOS.TRADUCCION_RECITACION && prefs.modo !== MODOS.RECITACION ? 'Esta aleya no tiene segmentación fiable para este recitador: se reproduce sin palabra por palabra.' : '';
}
$('ajustes').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.modo) aplicar({ modo: t.dataset.modo });
  else if (t.dataset.rec) aplicar({ recitador: t.dataset.rec });
  else if (t.dataset.fondo) aplicar({ fondo: t.dataset.fondo });
  else if (t.dataset.paso) { const k = t.dataset.paso, max = k === 'repPalabra' ? 5 : 10; aplicar({ [k]: Math.max(1, Math.min(max, prefs[k] + Number(t.dataset.d))) }); }
});
document.querySelectorAll('[data-pref]').forEach(c => c.addEventListener('change', () => aplicar({ [c.dataset.pref]: c.checked })));
// Las pausas cambian el plan (reinician la aleya): se aplican al soltar el control, no en cada paso del arrastre.
const segTxt = ms => (ms / 1000).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' s';
$('pausa').oninput = e => { $('pausaV').textContent = segTxt(e.target.value); }; $('pausa').onchange = e => aplicar({ pausaMs: Number(e.target.value) });
$('pausaPal').oninput = e => { $('pausaPalV').textContent = segTxt(e.target.value); }; $('pausaPal').onchange = e => aplicar({ pausaPalabraMs: Number(e.target.value) });
$('velPal').oninput = e => { $('velPalV').textContent = Number(e.target.value).toLocaleString('es', { minimumFractionDigits: 1 }) + '×'; }; $('velPal').onchange = e => aplicar({ velocidadPalabras: Number(e.target.value) });
$('vel').oninput = e => aplicar({ velocidad: Number(e.target.value) });
$('dim').oninput = e => aplicar({ dim: Number(e.target.value) });
$('blur').oninput = e => aplicar({ blur: Number(e.target.value) });
$('voz').onchange = e => aplicar({ voz: e.target.value });
$('edicion').onchange = e => aplicar({ edicion: e.target.value });
$('fuentePalabra').onchange = e => aplicar({ fuentePalabra: e.target.value });
$('vozArabe').onchange = e => aplicar({ vozArabe: e.target.value });
$('fondoArchivo').onchange = async e => {
  const f = e.target.files?.[0]; if (!f) return;
  try { const b = await prepararImagen(f); await guardarFondoPropio(b).catch(() => {}); if (urlFondoPropio) URL.revokeObjectURL(urlFondoPropio); urlFondoPropio = URL.createObjectURL(b); aplicar({ fondo: FONDO_PROPIO, fondoOn: true }); }
  catch (err) { mostrarAviso('No se pudo usar esa imagen.', true); }
};

// ---- Selector de sura -----------------------------------------------------------------------------------------------
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9؀-ۿ ]/g, '');
function filtrarSuras() {
  const q = norm($('buscar').value).trim(), oidas = progreso.oidas;
  $('listaSuras').innerHTML = Object.entries(indice).filter(([n, s]) => !q || n === q || norm(s.nombre + ' ' + s.es).includes(q))
    .map(([n, s]) => `<button class="sura-op" data-sura="${n}"><span class="n">${n}</span><span><b>${esc(s.nombre)}</b><small>${esc(s.es)} · ${s.aleyas} aleyas${oidas[n]?.length ? ' · escuchadas ' + oidas[n].length : ''}</small></span></button>`).join('') || '<p class="nota">No se encontró ninguna sura.</p>';
}
$('buscar').oninput = filtrarSuras;
$('listaSuras').onclick = async e => {
  const b = e.target.closest('[data-sura]'); if (!b) return;
  const n = Number(b.dataset.sura), a = n === sura ? Number($('aleyaIr').value) : 1;
  cerrarHojas(); await abrirSura(n, a);
};
$('aleyaIr').onchange = () => { const a = Math.max(1, Math.min(Number($('aleyaIr').value) || 1, indice[sura].aleyas)); cerrarHojas(); motor?.irA(a - 1); };

// ---- Ciclo de vida -------------------------------------------------------------------------------------------------
(async function iniciar() {
  pintarPrefsVisibles(); aplicarFondo(); registrarSesionMultimedia();
  try { indice = await cargarIndice(); } catch (e) { $('tituloSura').textContent = 'Sin conexión'; mostrarAviso('No se pudo cargar el índice de suras. Revisa la conexión.'); return; }
  const { s, a } = parametros();
  await abrirSura(s, a);
  if (new URLSearchParams(location.search).get('auto') === '1') motor.reproducir(); // sólo pruebas: el navegador suele exigir un gesto
})();
// Expuesto para pruebas automáticas y depuración.
globalThis.__escucha = { get motor() { return motor; }, get prefs() { return prefs; }, get progreso() { return progreso; }, controlador };
