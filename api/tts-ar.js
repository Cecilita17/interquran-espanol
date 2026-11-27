// Voz neuronal de Microsoft Edge en ÁRABE para UNA palabra de una aleya (pronunciación aislada para
// aprender vocabulario). Sólo acepta (sura, aleya, posición de palabra, voz de la lista): el texto árabe
// lo obtiene el servidor de Quran.com, nunca del cliente, así que no sirve de TTS genérico.
// No es una recitación: la recitación completa del Corán sigue saliendo siempre de grabaciones auténticas.
import { EdgeTTS } from '@andresaya/edge-tts';

export const VOICES_AR = ['ar-SA-HamedNeural', 'ar-SA-ZariyahNeural'];
const MAX_CHARS = 60;

async function fetchWord(surah, ayah, position, signal) {
  // text_imlaei = ortografía estándar con tashkīl: las voces la leen mejor que la grafía uthmani con marcas coránicas.
  const r = await fetch(`https://api.quran.com/api/v4/verses/by_key/${surah}:${ayah}?words=true&word_fields=text_imlaei`, { signal });
  if (!r.ok) throw new Error('text-unavailable');
  const d = await r.json();
  const words = (d?.verse?.words || []).filter(w => w.char_type_name === 'word');
  return String(words[position - 1]?.text_imlaei || '');
}
// Deja sólo letras árabes y tashkīl básico; quita tatweel y signos de pausa/anotación coránicos.
export const limpiar = t => String(t || '').replace(/[ـۖ-ۭ]/g, '').replace(/[^ء-غف-ٰٟٱ]/g, '').trim();

async function synthesize(text, voice, signal) {
  return new EdgeTTS().generate(text, voice, { signal, timeout: 10000, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' });
}

export function createHandler({ getWord = fetchWord, speak = synthesize } = {}) {
  return async function handler(req, res) {
    const q = req.query || {};
    const surah = Number(q.s), ayah = Number(q.a), pos = Number(q.w), voice = q.v;
    if (!Number.isInteger(surah) || surah < 1 || surah > 114 || !Number.isInteger(ayah) || ayah < 1 || ayah > 286 ||
        !Number.isInteger(pos) || pos < 1 || pos > 250 || !VOICES_AR.includes(voice)) {
      return res.status(400).json({ code: 'TTS_INVALID' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const text = limpiar(await getWord(surah, ayah, pos, controller.signal));
      if (!text || text.length > MAX_CHARS) return res.status(422).json({ code: 'TTS_TEXT_INVALID' });
      const result = await speak(text, voice, controller.signal);
      const audio = Buffer.from(result.audio);
      if (!audio.length || audio.length > 1024 * 1024) throw new Error('invalid-audio');
      res.setHeader('Content-Type', 'audio/mpeg');
      // Depende sólo de (sura, aleya, palabra, voz): cacheable.
      res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
      return res.status(200).send(audio);
    } catch (error) {
      console.warn('[tts-ar] voz no disponible', error?.name || error?.message);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ code: 'TTS_UNAVAILABLE' });
    } finally {
      clearTimeout(timer);
    }
  };
}
export default createHandler();
