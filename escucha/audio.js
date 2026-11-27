// Controlador de audio de «Escucha inmersiva»: UN solo <audio> (grabaciones auténticas del
// recitador y voz neuronal de la traducción) más voz del dispositivo para el significado de cada
// palabra. Un único elemento garantiza que nada se solape y mantiene viva la sesión multimedia
// en segundo plano. Cada operación devuelve una promesa que se resuelve con
// 'ok' | 'cancelado' | 'error' | 'bloqueado' (autoplay denegado) | 'omitido'.

const dentroDe = (v, a, b) => Math.min(b, Math.max(a, v));

export function crearControlador({ elemento = new Audio(), sintesis = globalThis.speechSynthesis, lang = 'es-ES', ms = { set: setTimeout, clear: clearTimeout } } = {}) {
  const el = elemento;
  el.preload = 'auto';
  let actual = null; // operación en curso: { resolver, tipo, reanudar(), pausar(), limpiar() }
  let velocidad = 1;

  const terminar = (op, r) => { if (!op || op.hecho) return; op.hecho = true; op.limpiar?.(); if (actual === op) actual = null; op.resolver(r); };

  function cargar(url) {
    return new Promise((ok, fallo) => {
      if (el.getAttribute('data-url') === url && el.readyState >= 1) return ok();
      const fin = () => { el.removeEventListener('loadedmetadata', bien); el.removeEventListener('error', mal); };
      const bien = () => { fin(); ok(); }, mal = () => { fin(); fallo(new Error('audio')); };
      el.addEventListener('loadedmetadata', bien); el.addEventListener('error', mal);
      el.setAttribute('data-url', url); el.src = url; el.load();
    });
  }
  function posicionar(seg) {
    return new Promise(ok => {
      if (Math.abs(el.currentTime - seg) < 0.02) return ok();
      const alt = () => { el.removeEventListener('seeked', alt); ok(); };
      el.addEventListener('seeked', alt); el.currentTime = seg;
    });
  }

  // Reproduce [desdeMs, hastaMs) de una grabación. hastaMs null = hasta el final. Prueba las URL
  // alternativas del MISMO recitador si la primera falla.
  function reproducirClip({ url, urlsAlt = [], desdeMs = 0, hastaMs = null, velocidad: v, alTiempo = null }) {
    cancelar();
    if (v) velocidad = v;
    return new Promise(resolver => {
      const op = { resolver, tipo: 'clip', hecho: false, pausado: false, temporizador: null, raf: 0 };
      actual = op;
      const urls = [url, ...urlsAlt].filter(Boolean);
      const fin = Number.isFinite(hastaMs) ? hastaMs / 1000 : null;
      const vigila = () => {
        if (op.hecho || op.pausado) return;
        if (alTiempo) alTiempo(el.currentTime * 1000);
        if (fin != null) {
          const falta = fin - el.currentTime;
          if (falta <= 0.005) { el.pause(); if (alTiempo) alTiempo(fin * 1000); return terminar(op, 'ok'); }
          op.temporizador = ms.set(vigila, dentroDe(falta * 1000 / velocidad - 8, 4, 250));
        }
      };
      const bucleVisual = () => { if (op.hecho || op.pausado || !alTiempo) return; alTiempo(el.currentTime * 1000); op.raf = requestAnimationFrame(bucleVisual); };
      op.arrancarVigilancia = () => { op.pausado = false; op.iniciado = true; vigila(); if (alTiempo && typeof requestAnimationFrame === 'function') op.raf = requestAnimationFrame(bucleVisual); };
      op.limpiar = () => { ms.clear(op.temporizador); if (op.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(op.raf); el.removeEventListener('ended', alFinal); el.removeEventListener('error', alError); };
      const alFinal = () => { if (alTiempo) alTiempo(el.duration * 1000); terminar(op, 'ok'); };
      // Los fallos de carga los gestiona intentar() (con URL alternativas); aquí sólo los de mitad de reproducción.
      const alError = () => { if (op.iniciado && !op.hecho) terminar(op, 'error'); };
      op.pausar = () => { op.pausado = true; ms.clear(op.temporizador); el.pause(); };
      op.reanudar = () => {
        if (op.diferido) { const f = op.diferido; op.diferido = null; op.pausado = false; return f(); }
        el.playbackRate = velocidad; op.pausado = false;
        el.play().then(() => op.arrancarVigilancia()).catch(e => terminar(op, e?.name === 'NotAllowedError' ? 'bloqueado' : 'error'));
      };
      el.addEventListener('ended', alFinal); el.addEventListener('error', alError);
      async function intentar(i) {
        if (op.hecho) return;
        if (i >= urls.length) return terminar(op, 'error');
        try {
          await cargar(urls[i]); if (op.hecho) return;
          el.playbackRate = velocidad; el.defaultPlaybackRate = velocidad;
          await posicionar(desdeMs / 1000); if (op.hecho) return;
          if (op.pausado) { op.diferido = () => intentar(i); return; } // pausa durante la carga: arranca al reanudar
          await el.play(); if (op.hecho) return;
          op.arrancarVigilancia();
        } catch (e) {
          if (op.hecho) return;
          if (e?.name === 'NotAllowedError') return terminar(op, 'bloqueado');
          if (e?.name === 'AbortError') { if (op.pausado) op.diferido = () => intentar(i); return; }
          intentar(i + 1);
        }
      }
      intentar(0);
    });
  }

  // Voz de la traducción: mp3 del servidor (voz neuronal) y, si falla, voz del dispositivo.
  async function hablar({ url, texto }) {
    if (!url) return hablarLocal({ texto });
    cancelar();
    const r = await new Promise(resolver => {
      const op = { resolver, tipo: 'voz', hecho: false };
      actual = op;
      const alFinal = () => terminar(op, 'ok'), alError = () => terminar(op, 'error');
      op.limpiar = () => { el.removeEventListener('ended', alFinal); el.removeEventListener('error', alError); };
      op.pausar = () => { op.pausado = true; el.pause(); };
      op.reanudar = () => { op.pausado = false; el.play().catch(e => { if (e?.name !== 'AbortError') terminar(op, e?.name === 'NotAllowedError' ? 'bloqueado' : 'error'); }); };
      el.addEventListener('ended', alFinal); el.addEventListener('error', alError);
      el.setAttribute('data-url', url); el.src = url; el.playbackRate = 1;
      el.play().catch(e => { if (e?.name === 'AbortError') return; /* pausa o cancelación */ terminar(op, e?.name === 'NotAllowedError' ? 'bloqueado' : 'error'); });
    });
    if (r === 'error' && texto) return hablarLocal({ texto });
    return r;
  }

  // Voz del dispositivo (significado de cada palabra). Con vigilante: si el sistema no llega a
  // empezar (p. ej. en segundo plano en Android) se omite en vez de quedarse colgado.
  function hablarLocal({ texto }) {
    cancelar();
    return new Promise(resolver => {
      if (!sintesis || typeof SpeechSynthesisUtterance === 'undefined' || !texto) return resolver('omitido');
      const op = { resolver, tipo: 'local', hecho: false, empezo: false };
      actual = op;
      let u = new SpeechSynthesisUtterance(String(texto).replace(/[—–]/g, ' ')); u.lang = lang; u.rate = .95;
      const vs = sintesis.getVoices?.() || []; const v = vs.find(x => x.lang?.toLowerCase().startsWith(lang.toLowerCase())) || vs.find(x => /^es/i.test(x.lang)); if (v) u.voice = v;
      let vigila = ms.set(() => { if (!op.empezo && !op.pausado) terminar(op, 'omitido'); }, 2500);
      let tope = ms.set(() => terminar(op, 'omitido'), 12000);
      u.onstart = () => { op.empezo = true; ms.clear(vigila); };
      u.onend = () => terminar(op, 'ok'); u.onerror = ev => terminar(op, ev?.error === 'canceled' || ev?.error === 'interrupted' ? 'cancelado' : 'omitido');
      op.limpiar = () => { ms.clear(vigila); ms.clear(tope); u.onend = u.onerror = u.onstart = null; try { sintesis.cancel(); } catch (e) {} };
      // La síntesis del sistema no se pausa de forma fiable: al pausar se cancela y se repite al reanudar.
      op.pausar = () => { op.pausado = true; ms.clear(vigila); try { sintesis.cancel(); } catch (e) {} };
      op.reanudar = () => { op.pausado = false; op.empezo = false; vigila = ms.set(() => { if (!op.empezo && !op.pausado) terminar(op, 'omitido'); }, 2500); try { sintesis.speak(u); } catch (e) { terminar(op, 'omitido'); } };
      try { sintesis.speak(u); } catch (e) { terminar(op, 'omitido'); }
    });
  }

  function pausar() { actual?.pausar?.(); }
  function reanudar() { actual?.reanudar?.(); }
  function cancelar() {
    const op = actual; if (!op) return;
    try { if (op.tipo === 'local') sintesis?.cancel(); else el.pause(); } catch (e) {}
    terminar(op, 'cancelado');
  }
  return { reproducirClip, hablar, hablarLocal, pausar, reanudar, cancelar, velocidad(v) { velocidad = v; el.playbackRate = v; }, elemento: el };
}
