// Datos de «Escucha inmersiva». Reutiliza las MISMAS fuentes que el lector, sin copiar el corpus:
//   · palabras (árabe con tashkīl, transliteración, significado): data/<sura>/ (glosario estático)
//   · traducción natural: Al Quran Cloud (es.cortes / es.garcia), igual que el lector
//   · audio y marcas de tiempo por palabra: Quran.com (recitaciones 7 y 10), igual que el lector
//   · voz de la traducción: /api/tts (voces neuronales), igual que el lector
import { evaluarSegmentos } from './segmentos.js';

export const RECITADORES = [
  { id: 'alafasy', nombre: 'Mishary Rashid Alafasy', rec: 7 },
  { id: 'shuraym', nombre: 'Saud Al-Shuraim', rec: 10 }
];
export const TRADUCCIONES = { cortes: 'es.cortes', garcia: 'es.garcia' };
export const VOCES_AR = ['ar-SA-HamedNeural', 'ar-SA-ZariyahNeural'];
export const VOCES = ['es-ES-ElviraNeural', 'es-ES-AlvaroNeural', 'es-MX-DaliaNeural', 'es-MX-JorgeNeural', 'es-AR-ElenaNeural', 'es-AR-TomasNeural', 'device'];

const CLOUD = 'https://api.alquran.cloud/v1';
const QCOM = 'https://api.quran.com/api/v4';
const CDN = ['https://audio.qurancdn.com/', 'https://verses.quran.com/'];

async function json(url, opciones) {
  const r = await fetch(url, opciones);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.json();
}
const memo = new Map();
const unico = (clave, fn) => { if (!memo.has(clave)) memo.set(clave, fn().catch(e => { memo.delete(clave); throw e; })); return memo.get(clave); };

export const cargarIndice = () => unico('indice', () => json('/data/suras.json'));

// ---- Carga bajo demanda: para mostrar UNA aleya sólo se descarga lo que ésta necesita; lo siguiente se adelanta en segundo plano.
// Palabras: sólo el bloque del glosario que contiene la aleya (en Al-Baqara hay 14 bloques de ~40 KB).
const manifiesto = slug => unico('man:' + slug, () => json(`/data/${slug}/index.json`));
function cargarBloque(slug, archivo) {
  return unico(`bloque:${slug}:${archivo}`, async () => {
    const b = await json(`/data/${slug}/${archivo}`), out = {};
    for (const [n, ws] of Object.entries(b.aleyas || {})) if (Array.isArray(ws) && ws.length && ws.every((w, i) => w && w.ar && w.pos === i + 1)) out[n] = ws;
    return out;
  });
}
export async function palabrasDeAleya(slug, aleya) {
  const man = await manifiesto(slug), lista = man.bloques || [];
  const k = lista.findIndex(b => aleya >= b.desde && aleya <= b.hasta);
  if (k < 0) return null;
  const datos = await cargarBloque(slug, lista[k].archivo);
  if (lista[k + 1] && aleya >= lista[k].hasta - 8) cargarBloque(slug, lista[k + 1].archivo).catch(() => {}); // cerca del final del bloque: adelanta el siguiente
  return datos[String(aleya)] || null;
}

// Traducción: la primera aleya se pide sola (~1 KB); la sura completa se trae en segundo plano para las siguientes.
const traducciones = {}; // 'sura:edición' → [texto por aleya] (cuando ya llegó completa)
export function cargarTraduccion(sura, clave) {
  const ed = TRADUCCIONES[clave] || TRADUCCIONES.cortes;
  return unico(`trad:${sura}:${ed}`, async () => {
    const d = await json(`${CLOUD}/surah/${sura}/${ed}`);
    const lista = (d.data?.ayahs || []).map(a => String(a.text || '').trim());
    traducciones[`${sura}:${ed}`] = lista;
    return lista;
  });
}
export async function traduccionDeAleya(sura, indice, clave) {
  const ed = TRADUCCIONES[clave] || TRADUCCIONES.cortes, lista = traducciones[`${sura}:${ed}`];
  if (lista) return lista[indice] || '';
  cargarTraduccion(sura, clave).catch(() => {});
  const d = await json(`${CLOUD}/ayah/${sura}:${indice + 1}/${ed}`);
  return String(d.data?.text || '').trim();
}

// Recitación: Quran.com la entrega por páginas de 50 aleyas; sólo se pide la página de la aleya (y la siguiente si se acerca al final).
const PAGINA = 50;
function cargarPaginaRecitacion(sura, rec, pagina) {
  return unico(`rec:${sura}:${rec}:${pagina}`, async () => {
    const d = await json(`${QCOM}/recitations/${rec}/by_chapter/${sura}?fields=segments&per_page=${PAGINA}&page=${pagina}`), out = {};
    for (const f of d.audio_files || []) {
      const i = Number(String(f.verse_key || '').split(':')[1]) - 1;
      if (!Number.isInteger(i) || i < 0 || !f.url) continue;
      const ruta = String(f.url).replace(/^\/+/, ''), abs = /^https?:/.test(ruta);
      out[i] = { url: abs ? ruta : CDN[0] + ruta, urlsAlt: abs ? [] : [CDN[1] + ruta], segmentos: f.segments || [] };
    }
    return { datos: out, total: d.pagination?.total_pages || 1 };
  });
}
export async function recitacionDeAleya(sura, rec, indice) {
  const pagina = Math.floor(indice / PAGINA) + 1, { datos, total } = await cargarPaginaRecitacion(sura, rec, pagina);
  if (indice % PAGINA >= PAGINA - 15 && pagina < total) cargarPaginaRecitacion(sura, rec, pagina + 1).catch(() => {});
  return datos[indice] || null;
}

export function urlVoz(sura, aleya, traduccion, voz) {
  if (voz === 'device') return null;
  return `/api/tts?s=${sura}&a=${aleya}&t=${traduccion === 'garcia' ? 'garcia' : 'cortes'}&v=${encodeURIComponent(voz)}`;
}

export const urlVozSignificado = (sura, aleya, pos, voz) => voz === 'device' ? null : `/api/tts-glosa?s=${sura}&a=${aleya}&w=${pos}&v=${encodeURIComponent(voz)}`;
export const urlVozPalabra = (sura, aleya, pos, voz) => `/api/tts-ar?s=${sura}&a=${aleya}&w=${pos}&v=${encodeURIComponent(voz)}`;

// Datos listos para el motor (construirPlan / ejecutar) de una aleya.
export async function datosAleya({ sura, indice, slug, prefs }) {
  const rec = RECITADORES.find(r => r.id === prefs.recitador) || RECITADORES[0];
  let recitacionFalla = false;
  // Las tres fuentes se piden a la vez y cada una descarga sólo lo necesario para esta aleya.
  const [ws, texto, r] = await Promise.all([
    palabrasDeAleya(slug, indice + 1),
    traduccionDeAleya(sura, indice, prefs.edicion).catch(() => ''),
    recitacionDeAleya(sura, rec.rec, indice).catch(() => { recitacionFalla = true; return null; })
  ]);
  if (!ws) return null;
  const ev = r ? evaluarSegmentos(r.segmentos, ws.length) : { fiable: false, rangos: null, porPalabra: null, motivo: recitacionFalla ? 'recitador no disponible' : 'sin audio' };
  return {
    clave: `${sura}:${indice + 1}`, sura, aleya: indice + 1, nPalabras: ws.length,
    palabras: ws,
    significados: ws.map(w => (w.es && w.es !== '—') ? w.es : ''),
    traduccion: texto, traduccionDisponible: !!texto, urlTraduccion: urlVoz(sura, indice + 1, prefs.edicion, prefs.voz),
    // Voz neuronal del significado en español de cada palabra (null si no hay glosa o se eligió la voz del dispositivo).
    urlsSignificado: ws.map((w, i) => (w.es && w.es !== '—') ? urlVozSignificado(sura, indice + 1, i + 1, prefs.voz) : null),
    // Voz neuronal árabe de cada palabra (pronunciación aislada, no recitación).
    urlsPalabra: ws.map((_, i) => urlVozPalabra(sura, indice + 1, i + 1, prefs.vozArabe)), palabrasVoz: ws.length > 0,
    urlAudio: r?.url || null, urlsAlt: r?.urlsAlt || [], recitacionDisponible: !!r?.url,
    rangos: ev.rangos, clips: ev.porPalabra, palabrasFiables: !!(ev.fiable && r?.url), motivoSinMarcas: ev.fiable ? '' : ev.motivo,
    revisada: ws.every(w => w.estado === 'revisada')
  };
}
