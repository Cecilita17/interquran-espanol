// Voz neuronal en español para el SIGNIFICADO de una palabra (glosa) del palabra por palabra. Así suena
// igual que la traducción, se puede precargar y funciona con la pantalla apagada (la voz del dispositivo no).
// Sólo acepta (sura, aleya, posición, voz de la lista): el texto sale del glosario estático publicado
// (data/<sura>/…) en un origen FIJO, nunca del cliente, así que no sirve de TTS genérico.
import { EdgeTTS } from '@andresaya/edge-tts';
import { VOICES } from './tts.js';

const ORIGEN = process.env.GLOSAS_ORIGEN || 'https://interquran-espanol.vercel.app'; // fijo en producción; la variable sólo la usan las pruebas
const MAX_CHARS = 120;

async function json(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('data-unavailable');
  return r.json();
}
async function fetchGlosa(surah, ayah, pos, signal) {
  const suras = await json(`${ORIGEN}/data/suras.json`, signal);
  const slug = suras?.[surah]?.slug;
  if (!/^[a-z-]+$/.test(slug || '')) throw new Error('sura-unknown');
  const man = await json(`${ORIGEN}/data/${slug}/index.json`, signal);
  const bloque = (man.bloques || []).find(b => ayah >= b.desde && ayah <= b.hasta);
  if (!bloque || !/^[\w.-]+\.json$/.test(bloque.archivo)) throw new Error('block-unknown');
  const datos = await json(`${ORIGEN}/data/${slug}/${bloque.archivo}`, signal);
  const w = datos?.aleyas?.[ayah]?.[pos - 1];
  return w && w.pos === pos ? String(w.es || '') : '';
}
export const limpiar = t => String(t || '').replace(/\[\?[^\]]*\]/g, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

async function synthesize(text, voice, signal) {
  return new EdgeTTS().generate(text, voice, { signal, timeout: 10000, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' });
}

export function createHandler({ getGlosa = fetchGlosa, speak = synthesize } = {}) {
  return async function handler(req, res) {
    const q = req.query || {};
    const surah = Number(q.s), ayah = Number(q.a), pos = Number(q.w), voice = q.v;
    if (!Number.isInteger(surah) || surah < 1 || surah > 114 || !Number.isInteger(ayah) || ayah < 1 || ayah > 286 ||
        !Number.isInteger(pos) || pos < 1 || pos > 250 || !VOICES.includes(voice)) {
      return res.status(400).json({ code: 'TTS_INVALID' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const text = limpiar(await getGlosa(surah, ayah, pos, controller.signal)).replace(/^[—–-]+$/, '');
      if (!text || text.length > MAX_CHARS) return res.status(422).json({ code: 'TTS_TEXT_INVALID' });
      const result = await speak(text, voice, controller.signal);
      const audio = Buffer.from(result.audio);
      if (!audio.length || audio.length > 1024 * 1024) throw new Error('invalid-audio');
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800'); // la glosa puede revisarse: no inmutable
      return res.status(200).send(audio);
    } catch (error) {
      console.warn('[tts-glosa] voz no disponible', error?.name || error?.message);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ code: 'TTS_UNAVAILABLE' });
    } finally {
      clearTimeout(timer);
    }
  };
}
export default createHandler();
