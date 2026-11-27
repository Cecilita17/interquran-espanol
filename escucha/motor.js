// Motor de reproducción de «Escucha inmersiva»: máquina de estados sin DOM.
//
// Estados:   inactivo → cargando → reproduciendo ⇄ pausado → terminado | error
// Un «plan» es la lista plana de pasos de una aleya (traducción, palabra, significado,
// recitación, pausa). El motor ejecuta UN paso a la vez con un único controlador de audio, y
// cada cambio (pausa, salto de aleya, cambio de modo, parada) incrementa `gen` y cancela el
// paso pendiente, así ningún audio viejo puede solaparse ni avanzar el plan nuevo.
import { palabraActiva } from './segmentos.js';

export const MODOS = {
  TRADUCCION_RECITACION: 'traduccion-recitacion',
  PALABRA: 'palabra',
  COMBINADA: 'combinada',
  RECITACION: 'recitacion'
};
export const ESTADOS = ['inactivo', 'cargando', 'reproduciendo', 'pausado', 'terminado', 'error'];

export const PREFS_MOTOR = {
  modo: MODOS.COMBINADA,
  repPalabra: 1,      // veces que se repite cada palabra (árabe + significado)
  repAleya: 1,        // veces que se repite la recitación completa (en el modo 2, todo el recorrido)
  pausaMs: 150,       // silencio entre bloques (traducción → palabras → recitación, repeticiones)
  pausaPalabraMs: 150, // silencio dentro del palabra por palabra (entre una palabra y la siguiente)
  velocidadPalabras: 1.2, // ritmo del significado hablado y de la palabra árabe (no de la recitación)
  autoavance: true,
  traduccion: true,   // «traducción natural»: voz y panel
  glosas: true,       // significado en español de cada palabra: voz y texto
  fuentePalabra: 'voz', // cómo suena cada palabra árabe: 'voz' (voz neuronal) | 'recitacion' (fragmento real del recitador)
  velocidad: 1
};

// Aleya esperada por construirPlan:
//   { nPalabras, traduccionDisponible, palabrasFiables (hay clips por palabra con marcas reales),
//     palabrasVoz (hay voz neuronal árabe por palabra), recitacionDisponible }
export function construirPlan(aleya, prefs) {
  const p = { ...PREFS_MOTOR, ...prefs };
  const avisos = [];
  const pasos = [];
  const pausa = () => { if (p.pausaMs > 0 && pasos.length && pasos[pasos.length - 1].tipo !== 'pausa') pasos.push({ tipo: 'pausa', ms: p.pausaMs }); };
  const quitarPausaFinal = () => { while (pasos.length && pasos[pasos.length - 1].tipo === 'pausa') pasos.pop(); };
  const rep = n => Math.max(1, Math.min(10, Math.floor(Number(n)) || 1));

  const quiereTraduccion = (p.modo === MODOS.TRADUCCION_RECITACION || p.modo === MODOS.COMBINADA) && p.traduccion;
  let quierePalabras = p.modo === MODOS.PALABRA || p.modo === MODOS.COMBINADA;
  const quiereRecitacion = p.modo !== MODOS.PALABRA;

  const conVoz = p.fuentePalabra !== 'recitacion';
  if (quierePalabras && conVoz && !aleya.palabrasVoz) {
    quierePalabras = false;
    avisos.push('Voz árabe no disponible para esta aleya: se desactiva el modo palabra por palabra.');
  } else if (quierePalabras && !conVoz && !aleya.palabrasFiables) {
    quierePalabras = false;
    avisos.push('Esta aleya no tiene una segmentación fiable para este recitador: se desactiva el modo palabra por palabra.');
  }
  // Modo 2 sin segmentación: sólo queda la recitación completa auténtica.
  const recitacionFinal = quiereRecitacion || (p.modo === MODOS.PALABRA && !quierePalabras);

  if (quiereTraduccion) {
    if (aleya.traduccionDisponible) { pasos.push({ tipo: 'traduccion' }); pausa(); }
    else avisos.push('Traducción no disponible para esta aleya.');
  }
  if (quierePalabras) {
    const pasada = [];
    for (let i = 0; i < aleya.nPalabras; i++) {
      for (let r = 0; r < rep(p.repPalabra); r++) {
        // Primero el significado en español y después la palabra en árabe (voz neuronal o, si se elige, clip real de la recitación).
        if (p.glosas) pasada.push({ tipo: 'significado', i });
        pasada.push({ tipo: conVoz ? 'palabraVoz' : 'palabra', i, rep: r + 1 });
        if (p.pausaPalabraMs > 0) pasada.push({ tipo: 'pausa', ms: p.pausaPalabraMs });
      }
    }
    // En el modo 2, «repeticiones por aleya» repite el recorrido completo.
    const vueltas = p.modo === MODOS.PALABRA ? rep(p.repAleya) : 1;
    for (let v = 0; v < vueltas; v++) {
      for (const s of pasada) pasos.push({ ...s });
      quitarPausaFinal(); // la pausa corta entre palabras no se arrastra al cambio de bloque
      if (v < vueltas - 1 || p.modo === MODOS.COMBINADA) pausa();
    }
  }
  if (recitacionFinal) {
    if (aleya.recitacionDisponible === false) avisos.push('Audio de recitación no disponible para esta aleya.');
    else {
      const veces = p.modo === MODOS.PALABRA ? 1 : rep(p.repAleya);
      for (let r = 0; r < veces; r++) { pasos.push({ tipo: 'recitacion', rep: r + 1, de: veces }); if (r < veces - 1) pausa(); }
    }
  }
  quitarPausaFinal();
  return { pasos, avisos };
}

// Parte de las preferencias que cambia el plan (el resto no obliga a reiniciar la aleya).
const firmaPlan = p => [p.modo, p.repPalabra, p.repAleya, p.pausaMs, p.pausaPalabraMs, p.traduccion, p.glosas, p.fuentePalabra].join('|');

// opciones:
//   controlador  { reproducirClip, hablar, hablarLocal, pausar, reanudar, cancelar }  (ver audio.js)
//   obtenerAleya(i) → Promise<datos de la aleya>  (i: índice base 0 dentro de la sura)
//   total         número de aleyas de la sura
//   alEvento(ev)  notificaciones para la interfaz
//   temporizador  { set(fn, ms), clear(id) }  (inyectable para pruebas)
export function crearMotor({ controlador, obtenerAleya, total, alEvento = () => {}, prefs = {}, temporizador = { set: (f, ms) => setTimeout(f, ms), clear: id => clearTimeout(id) } }) {
  const m = {
    estado: 'inactivo', aleya: 0, paso: 0, plan: null, datos: null, prefs: { ...PREFS_MOTOR, ...prefs },
    gen: 0, total, quiereReproducir: false
  };
  let pausaGap = null; // { id, resta, inicio, resolver }
  let corriendo = false; // hay un bucle de reproducción vivo

  const emitir = ev => { try { alEvento(ev); } catch (e) { /* la interfaz no debe romper el motor */ } };
  const cambiarEstado = e => { if (m.estado !== e) { m.estado = e; emitir({ tipo: 'estado', estado: e }); } };

  function cancelarPendiente() {
    m.gen++;
    corriendo = false; // el bucle anterior queda obsoleto (su `finally` ya no lo marca): sin esto, play tras cambiar de modo/aleya en pausa no arrancaba nada
    if (pausaGap) { temporizador.clear(pausaGap.id); const r = pausaGap.resolver; pausaGap = null; r('cancelado'); }
    controlador.cancelar();
    emitir({ tipo: 'palabra', palabra: null });
  }

  function esperar(ms) {
    return new Promise(resolver => {
      const g = { resta: ms, inicio: 0, resolver, id: null };
      const arrancar = () => { g.inicio = Date.now(); g.id = temporizador.set(() => { if (pausaGap === g) pausaGap = null; resolver('ok'); }, g.resta); };
      g.arrancar = arrancar; pausaGap = g; arrancar();
    });
  }

  async function ejecutar(paso, gen) {
    const d = m.datos;
    switch (paso.tipo) {
      case 'pausa': return esperar(paso.ms);
      case 'traduccion':
        emitir({ tipo: 'palabra', palabra: null });
        return controlador.hablar({ clave: d.clave, texto: d.traduccion, url: d.urlTraduccion });
      case 'palabraVoz':
        emitir({ tipo: 'palabra', palabra: { desde: paso.i, hasta: paso.i + 1 } });
        return controlador.hablar({ clave: d.clave + ':' + (paso.i + 1), texto: d.palabras?.[paso.i]?.ar || '', url: d.urlsPalabra[paso.i], lang: 'ar-SA', velocidad: m.prefs.velocidadPalabras });
      case 'palabra': {
        const c = d.clips[paso.i];
        emitir({ tipo: 'palabra', palabra: { desde: paso.i, hasta: paso.i + 1 } });
        return controlador.reproducirClip({ url: d.urlAudio, urlsAlt: d.urlsAlt, desdeMs: c.ini, hastaMs: c.fin, velocidad: m.prefs.velocidad });
      }
      case 'significado':
        emitir({ tipo: 'palabra', palabra: { desde: paso.i, hasta: paso.i + 1 } });
        // Voz neuronal precargada (sin esperas ni arranque lento); si no hay, voz del dispositivo.
        if (d.urlsSignificado?.[paso.i]) return controlador.hablar({ clave: d.clave + ':s' + (paso.i + 1), texto: d.significados[paso.i], url: d.urlsSignificado[paso.i], lang: 'es-ES', velocidad: m.prefs.velocidadPalabras });
        return controlador.hablarLocal({ texto: d.significados[paso.i], velocidad: m.prefs.velocidadPalabras });
      case 'recitacion': {
        const rangos = d.rangos;
        let ultima = '';
        const alTiempo = t => {
          if (gen !== m.gen) return;
          const a = rangos ? palabraActiva(rangos, t) : null;
          const k = a ? a.desde + ':' + a.hasta : '';
          if (k !== ultima) { ultima = k; emitir({ tipo: 'palabra', palabra: a }); }
        };
        emitir({ tipo: 'palabra', palabra: null });
        const r = await controlador.reproducirClip({ url: d.urlAudio, urlsAlt: d.urlsAlt, desdeMs: 0, hastaMs: null, velocidad: m.prefs.velocidad, alTiempo: rangos ? alTiempo : null });
        return r;
      }
      default: return 'ok';
    }
  }

  async function prepararAleya(i, gen) {
    cambiarEstado('cargando');
    let datos;
    try { datos = await obtenerAleya(i); } catch (e) { datos = null; }
    if (gen !== m.gen) return false;
    if (!datos) { cambiarEstado('error'); emitir({ tipo: 'aviso', texto: 'No se pudieron cargar los datos de la aleya.' }); return false; }
    m.aleya = i; m.datos = datos; m.paso = 0;
    const { pasos, avisos } = construirPlan(datos, m.prefs);
    m.plan = pasos;
    emitir({ tipo: 'aleya', aleya: i, datos, avisos, plan: pasos });
    precargar(0);
    return true;
  }

  async function bucle(gen) {
    corriendo = true;
    try { await bucleInterno(gen); } finally { if (gen === m.gen) corriendo = false; }
  }
  // Pide por adelantado los audios que van a sonar enseguida (traducción y voces árabes de las próximas
  // palabras) para que el ritmo no dependa de la red en cada palabra.
  function precargar(desde = m.paso + 1, cuantos = 10) {
    if (!controlador.precargar || !m.plan || !m.datos) return;
    const d = m.datos, urls = [];
    for (let k = desde; k < m.plan.length && urls.length < cuantos; k++) {
      const p = m.plan[k];
      if (p.tipo === 'palabraVoz' && d.urlsPalabra?.[p.i]) urls.push(d.urlsPalabra[p.i]);
      else if (p.tipo === 'significado' && d.urlsSignificado?.[p.i]) urls.push(d.urlsSignificado[p.i]);
      else if (p.tipo === 'traduccion' && d.urlTraduccion) urls.push(d.urlTraduccion);
    }
    if (urls.length) controlador.precargar(urls);
  }
  // Con avance automático, cuando empieza la recitación final se adelanta la traducción y las primeras palabras de la aleya siguiente.
  async function precargarSiguiente(gen) {
    if (!controlador.precargar || !m.prefs.autoavance || m.aleya >= m.total - 1) return;
    try {
      const sig = await obtenerAleya(m.aleya + 1);
      if (gen !== m.gen || !sig) return;
      const { pasos } = construirPlan(sig, m.prefs), urls = [];
      for (const p of pasos) { if (urls.length >= 8) break; if (p.tipo === 'traduccion' && sig.urlTraduccion) urls.push(sig.urlTraduccion); else if (p.tipo === 'significado' && sig.urlsSignificado?.[p.i]) urls.push(sig.urlsSignificado[p.i]); else if (p.tipo === 'palabraVoz' && sig.urlsPalabra?.[p.i]) urls.push(sig.urlsPalabra[p.i]); }
      if (urls.length) controlador.precargar(urls);
    } catch (e) { /* adelantar es opcional */ }
  }
  async function bucleInterno(gen) {
    cambiarEstado('reproduciendo');
    while (gen === m.gen) {
      if (m.paso >= m.plan.length) {
        emitir({ tipo: 'escuchada', aleya: m.aleya });
        if (m.prefs.autoavance && m.aleya < m.total - 1) {
          if (!(await prepararAleya(m.aleya + 1, gen))) return;
          cambiarEstado('reproduciendo');
          continue;
        }
        m.quiereReproducir = false;
        cambiarEstado('terminado');
        emitir({ tipo: 'fin', finSura: m.aleya >= m.total - 1 });
        return;
      }
      const paso = m.plan[m.paso];
      emitir({ tipo: 'paso', paso, indice: m.paso, de: m.plan.length });
      precargar();
      if (paso.tipo === 'recitacion' && paso.rep === 1) precargarSiguiente(gen);
      const r = await ejecutar(paso, gen);
      if (gen !== m.gen) return; // cancelado o reemplazado: este bucle ya no manda
      if (r === 'bloqueado') {
        m.quiereReproducir = false;
        cambiarEstado('pausado');
        emitir({ tipo: 'aviso', texto: 'El navegador bloqueó el audio: toca reproducir.' });
        return;
      }
      if (r === 'error') emitir({ tipo: 'aviso', texto: paso.tipo === 'traduccion' ? 'Voz de la traducción no disponible; se continúa.' : 'No se pudo reproducir un audio; se continúa.', paso: paso.tipo });
      m.paso++;
    }
  }

  async function arrancarDesde(i, gen) {
    if (!(await prepararAleya(i, gen))) return;
    if (m.quiereReproducir) bucle(gen); else cambiarEstado('pausado');
  }

  const api = {
    get estado() { return m.estado; },
    get aleya() { return m.aleya; },
    get prefs() { return { ...m.prefs }; },
    get plan() { return m.plan; },
    get paso() { return m.paso; },

    // Carga una aleya sin reproducir (queda «pausado» con la aleya lista).
    cargar(i) {
      cancelarPendiente(); m.quiereReproducir = false;
      return arrancarDesde(Math.max(0, Math.min(i, m.total - 1)), m.gen);
    },
    async reproducir(i = m.aleya) {
      if (m.estado === 'reproduciendo') return;
      if (m.estado === 'cargando') { m.quiereReproducir = true; return; } // empezará en cuanto lleguen los datos
      if (m.estado === 'pausado' && m.plan && i === m.aleya) return api.reanudar();
      cancelarPendiente(); m.quiereReproducir = true;
      return arrancarDesde(Math.max(0, Math.min(i, m.total - 1)), m.gen);
    },
    pausar() {
      if (m.estado === 'cargando') { m.quiereReproducir = false; return; }
      if (m.estado !== 'reproduciendo') return;
      m.quiereReproducir = false;
      if (pausaGap) { temporizador.clear(pausaGap.id); pausaGap.resta = Math.max(0, pausaGap.resta - (Date.now() - pausaGap.inicio)); }
      controlador.pausar();
      cambiarEstado('pausado');
    },
    reanudar() {
      if (m.estado === 'terminado') return api.reproducir(m.aleya >= m.total - 1 ? 0 : m.aleya);
      if (m.estado !== 'pausado') return;
      if (!m.plan) return api.reproducir(m.aleya);
      m.quiereReproducir = true;
      cambiarEstado('reproduciendo');
      if (!corriendo) bucle(m.gen); // el bucle terminó (p. ej. audio bloqueado): reintenta el paso actual
      else if (pausaGap) pausaGap.arrancar(); else controlador.reanudar();
    },
    detener() { cancelarPendiente(); m.quiereReproducir = false; m.plan = null; cambiarEstado('inactivo'); },
    irA(i) {
      const era = m.estado === 'reproduciendo';
      cancelarPendiente(); m.quiereReproducir = era;
      return arrancarDesde(Math.max(0, Math.min(i, m.total - 1)), m.gen);
    },
    siguiente() { return m.aleya < m.total - 1 ? api.irA(m.aleya + 1) : undefined; },
    anterior() { return m.aleya > 0 ? api.irA(m.aleya - 1) : undefined; },
    // Reinicia la aleya actual desde su primer paso.
    reiniciarAleya() { return api.irA(m.aleya); },
    actualizarPrefs(nuevas) {
      const antes = firmaPlan(m.prefs);
      m.prefs = { ...m.prefs, ...nuevas };
      emitir({ tipo: 'prefs', prefs: { ...m.prefs } });
      if (firmaPlan(m.prefs) !== antes && m.datos) return api.irA(m.aleya); // el plan cambió: se reinicia la aleya
      if ('velocidad' in nuevas) controlador.velocidad?.(m.prefs.velocidad);
    },
    // Rebusca los datos de la aleya actual (p. ej. al cambiar de recitador) sin perder el estado.
    recargarDatos() { return api.irA(m.aleya); }
  };
  // `alternar` explícito (sin sorpresas de promesas).
  api.alternar = () => { if (m.estado === 'reproduciendo') api.pausar(); else if (m.estado === 'pausado' || m.estado === 'terminado') return api.reanudar(); else return api.reproducir(); };
  return api;
}
