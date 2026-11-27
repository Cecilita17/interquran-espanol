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

// → { [nAleya]: [{ar, tr, es, estado}] } con comprobación de que `pos` es 1..n.
export function cargarPalabras(slug) {
  return unico('palabras:' + slug, async () => {
    const man = await json(`/data/${slug}/index.json`);
    const bloques = await Promise.all((man.bloques || []).map(b => json(`/data/${slug}/${b.archivo}`)));
    const out = {};
    for (const b of bloques) for (const [n, ws] of Object.entries(b.aleyas || {})) {
      if (Array.isArray(ws) && ws.length && ws.every((w, i) => w && w.ar && w.pos === i + 1)) out[n] = ws;
    }
    return out;
  });
}

// → [texto por aleya] (índice 0 = aleya 1); lanza si la fuente no responde.
export function cargarTraduccion(sura, clave) {
  const ed = TRADUCCIONES[clave] || TRADUCCIONES.cortes;
  return unico(`trad:${sura}:${ed}`, async () => {
    const d = await json(`${CLOUD}/surah/${sura}/${ed}`);
    return (d.data?.ayahs || []).map(a => String(a.text || '').trim());
  });
}

// → { [índice base 0]: { url, urlsAlt, segmentos } } con las marcas CRUDAS de Quran.com
// para ESE recitador; la fiabilidad se evalúa por aleya con evaluarSegmentos().
export function cargarRecitacion(sura, rec) {
  return unico(`rec:${sura}:${rec}`, async () => {
    const out = {};
    for (let pagina = 1; pagina <= 12; pagina++) {
      const d = await json(`${QCOM}/recitations/${rec}/by_chapter/${sura}?fields=segments&per_page=50&page=${pagina}`);
      for (const f of d.audio_files || []) {
        const i = Number(String(f.verse_key || '').split(':')[1]) - 1;
        if (!Number.isInteger(i) || i < 0 || !f.url) continue;
        const ruta = String(f.url).replace(/^\/+/, '');
        const abs = /^https?:/.test(ruta);
        out[i] = { url: abs ? ruta : CDN[0] + ruta, urlsAlt: abs ? [] : [CDN[1] + ruta], segmentos: f.segments || [] };
      }
      if (!d.pagination?.next_page) break;
    }
    return out;
  });
}

export function urlVoz(sura, aleya, traduccion, voz) {
  if (voz === 'device') return null;
  return `/api/tts?s=${sura}&a=${aleya}&t=${traduccion === 'garcia' ? 'garcia' : 'cortes'}&v=${encodeURIComponent(voz)}`;
}

export const urlVozPalabra = (sura, aleya, pos, voz) => `/api/tts-ar?s=${sura}&a=${aleya}&w=${pos}&v=${encodeURIComponent(voz)}`;

// Datos listos para el motor (construirPlan / ejecutar) de una aleya.
export async function datosAleya({ sura, indice, slug, prefs }) {
  const rec = RECITADORES.find(r => r.id === prefs.recitador) || RECITADORES[0];
  const [palabras, trad, recit] = await Promise.all([
    cargarPalabras(slug),
    cargarTraduccion(sura, prefs.edicion).catch(() => null),
    cargarRecitacion(sura, rec.rec).catch(() => null)
  ]);
  const ws = palabras[String(indice + 1)];
  if (!ws) return null;
  const r = recit?.[indice];
  const ev = r ? evaluarSegmentos(r.segmentos, ws.length) : { fiable: false, rangos: null, porPalabra: null, motivo: recit ? 'sin audio' : 'recitador no disponible' };
  const texto = trad?.[indice] || '';
  return {
    clave: `${sura}:${indice + 1}`, sura, aleya: indice + 1, nPalabras: ws.length,
    palabras: ws,
    significados: ws.map(w => (w.es && w.es !== '—') ? w.es : ''),
    traduccion: texto, traduccionDisponible: !!texto, urlTraduccion: urlVoz(sura, indice + 1, prefs.edicion, prefs.voz),
    // Voz neuronal árabe de cada palabra (pronunciación aislada, no recitación).
    urlsPalabra: ws.map((_, i) => urlVozPalabra(sura, indice + 1, i + 1, prefs.vozArabe)), palabrasVoz: ws.length > 0,
    urlAudio: r?.url || null, urlsAlt: r?.urlsAlt || [], recitacionDisponible: !!r?.url,
    rangos: ev.rangos, clips: ev.porPalabra, palabrasFiables: !!(ev.fiable && r?.url), motivoSinMarcas: ev.fiable ? '' : ev.motivo,
    revisada: ws.every(w => w.estado === 'revisada')
  };
}
