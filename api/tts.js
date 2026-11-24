// Voz en español para la traducción de cada aleya: voces neuronales de Microsoft Edge
// (las mismas que usa LinguaFlow). Sólo acepta una referencia de aleya y una voz de la
// lista; el texto lo obtiene el servidor de Al Quran Cloud, nunca del cliente.
import { EdgeTTS } from '@andresaya/edge-tts';

export const VOICES = [
  'es-ES-ElviraNeural', 'es-ES-AlvaroNeural',
  'es-MX-DaliaNeural', 'es-MX-JorgeNeural',
  'es-AR-ElenaNeural', 'es-AR-TomasNeural'
];
const EDITIONS = { cortes: 'es.cortes', garcia: 'es.garcia' };
const MAX_CHARS = 2400;

async function fetchAyah(surah, ayah, edition, signal) {
  const r = await fetch(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/${edition}`, { signal });
  if (!r.ok) throw new Error('text-unavailable');
  const d = await r.json();
  return String(d?.data?.text || '');
}
async function synthesize(text, voice, signal) {
  return new EdgeTTS().generate(text, voice, { signal, timeout: 10000, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' });
}

export function createHandler({ getText = fetchAyah, speak = synthesize } = {}) {
  return async function handler(req, res) {
    const q = req.query || {};
    const surah = Number(q.s), ayah = Number(q.a), edition = EDITIONS[q.t], voice = q.v;
    if (!Number.isInteger(surah) || surah < 1 || surah > 114 || !Number.isInteger(ayah) || ayah < 1 || ayah > 286 || !edition || !VOICES.includes(voice)) {
      return res.status(400).json({ code: 'TTS_INVALID' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const text = (await getText(surah, ayah, edition, controller.signal)).replace(/\s+/g, ' ').replace(/[<>]/g, '').trim();
      if (!text || text.length > MAX_CHARS) return res.status(422).json({ code: 'TTS_TEXT_INVALID' });
      const result = await speak(text, voice, controller.signal);
      const audio = Buffer.from(result.audio);
      if (!audio.length || audio.length > 4 * 1024 * 1024) throw new Error('invalid-audio');
      res.setHeader('Content-Type', 'audio/mpeg');
      // El contenido depende sólo de (sura, aleya, traducción, voz): cacheable.
      res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
      return res.status(200).send(audio);
    } catch (error) {
      console.warn('[tts] voz no disponible', error?.name || error?.message);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ code: 'TTS_UNAVAILABLE' });
    } finally {
      clearTimeout(timer);
    }
  };
}
export default createHandler();
