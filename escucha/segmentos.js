// Marcas de tiempo palabra por palabra de Quran.com (recitaciones 7 = Alafasy, 10 = Shuraym).
// Formato de cada segmento: [palabraDesde, palabraHasta, msInicio, msFin] (índices de palabra
// base 0, «hasta» exclusivo; tiempos relativos al audio de ESA aleya y de ESE recitador).
// Este módulo sólo VALIDA y deriva datos de marcas reales: nunca inventa ni reparte tiempos.

// Silencio real posterior a una palabra que se conserva al reproducirla sola, para no
// cortar la pronunciación final. Nunca se extiende más allá del inicio de la palabra siguiente.
export const COLA_MS = 250;

const esEntero = n => Number.isInteger(n);

// Devuelve { fiable, porPalabra, motivo, rangos }.
//  - rangos: segmentos válidos (para resaltar durante la recitación completa); null si no hay
//    una cobertura ordenada y completa de todas las palabras.
//  - porPalabra: un clip {ini, fin} por palabra; sólo si hay EXACTAMENTE un segmento por palabra.
export function evaluarSegmentos(crudo, nPalabras) {
  const vacio = motivo => ({ fiable: false, rangos: null, porPalabra: null, motivo });
  if (!Array.isArray(crudo) || !crudo.length) return vacio('sin marcas de tiempo');
  if (!esEntero(nPalabras) || nPalabras < 1) return vacio('aleya sin palabras');
  const segs = [];
  for (const s of crudo) {
    if (!Array.isArray(s) || s.length !== 4 || !s.every(esEntero)) return vacio('segmento mal formado');
    const [desde, hasta, ini, fin] = s;
    if (desde < 0 || hasta <= desde || hasta > nPalabras) return vacio('palabra fuera de rango');
    if (ini < 0 || fin <= ini) return vacio('tiempo inválido');
    segs.push({ desde, hasta, ini, fin });
  }
  // Cobertura contigua y en orden: 0..n sin saltos ni solapes, con tiempos crecientes.
  let esperada = 0, finPrevio = -1;
  for (const s of segs) {
    if (s.desde !== esperada) return vacio('las marcas no cubren las palabras en orden');
    if (s.ini < finPrevio) return vacio('marcas de tiempo solapadas');
    esperada = s.hasta; finPrevio = s.fin;
  }
  if (esperada !== nPalabras) return vacio('faltan palabras en las marcas');
  const rangos = segs;
  if (segs.length !== nPalabras) return { fiable: false, rangos, porPalabra: null, motivo: 'las marcas agrupan varias palabras' };
  const porPalabra = segs.map((s, i) => {
    const sig = segs[i + 1];
    const fin = sig ? Math.min(sig.ini, s.fin + COLA_MS) : s.fin + COLA_MS;
    return { ini: s.ini, fin: Math.max(fin, s.fin) };
  });
  return { fiable: true, rangos, porPalabra, motivo: '' };
}

// Palabra(s) activa(s) en el instante tMs, a partir de marcas reales. Devuelve
// { desde, hasta } (hasta exclusivo) o null. Entre dos palabras se mantiene la anterior
// hasta que empieza la siguiente; pasado el final de la última, no hay palabra activa.
export function palabraActiva(rangos, tMs) {
  if (!rangos?.length || !(tMs >= 0)) return null;
  let k = -1;
  for (let i = 0; i < rangos.length; i++) { if (rangos[i].ini <= tMs) k = i; else break; }
  if (k < 0) return null;
  const r = rangos[k];
  if (k === rangos.length - 1 && tMs >= r.fin) return null;
  return { desde: r.desde, hasta: r.hasta };
}
