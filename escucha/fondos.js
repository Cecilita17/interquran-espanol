// Fondos decorativos de temática islámica, dibujados en SVG (sin imágenes externas ni
// derechos de autor) + fondo propio del usuario guardado en IndexedDB en su dispositivo.

const uri = svg => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
const SVG = (cuerpo, w = 800, h = 1400) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">${cuerpo}</svg>`;
function azar(semilla) { let s = semilla; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const degradado = (id, v, a = 0, b = 1) => `<linearGradient id="${id}" x1="0" y1="${a}" x2="0" y2="${b}">${v.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const estrella8 = (cx, cy, r) => { const p = []; for (let i = 0; i < 16; i++) { const a = Math.PI * i / 8 - Math.PI / 2, rr = i % 2 ? r * .62 : r; p.push((cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1)); } return p.join(' '); };
const luna = (x, y, r, c = '#f3dfa2') => `<mask id="lm"><rect width="800" height="1400" fill="#fff"/><circle cx="${x + r * .42}" cy="${y - r * .12}" r="${r * .86}" fill="#000"/></mask><circle cx="${x}" cy="${y}" r="${r}" fill="${c}" mask="url(#lm)"/>`;
function estrellas(n, sem, yMax) { const a = azar(sem); let o = ''; for (let i = 0; i < n; i++) o += `<circle cx="${(a() * 800).toFixed(0)}" cy="${(a() * yMax).toFixed(0)}" r="${(a() * 1.6 + .4).toFixed(1)}" fill="#fff" opacity="${(a() * .6 + .3).toFixed(2)}"/>`; return o; }

export const FONDOS = [
  { id: 'noche', nombre: 'Noche estrellada', css: () => uri(SVG(`<defs>${degradado('g', [[0, '#050818'], [.6, '#0e1a47'], [1, '#1d2f66']])}</defs><rect width="800" height="1400" fill="url(#g)"/>${estrellas(90, 7, 1000)}${luna(610, 230, 70)}`)) },
  { id: 'geometria', nombre: 'Geometría', css: () => { let t = ''; for (let y = 0; y < 1400; y += 120) for (let x = 0; x < 800; x += 120) t += `<polygon points="${estrella8(x + 60, y + 60, 48)}" fill="none" stroke="#e7c873" stroke-opacity=".28" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#e7c873" stroke-opacity=".2"/>`; return uri(SVG(`<defs>${degradado('g', [[0, '#052b33'], [1, '#0b1f3a']])}</defs><rect width="800" height="1400" fill="url(#g)"/>${t}`)); } },
  { id: 'mihrab', nombre: 'Mihrab', css: () => { let a = ''; for (let i = 0; i < 6; i++) { const m = 70 + i * 46; a += `<path d="M${m} 1400 V560 Q${m} 330 400 ${190 - i * 22} Q${800 - m} 330 ${800 - m} 560 V1400" fill="none" stroke="#e7c873" stroke-opacity="${(.55 - i * .07).toFixed(2)}" stroke-width="${3 - i * .3}"/>`; } return uri(SVG(`<defs>${degradado('g', [[0, '#04201a'], [1, '#0a3b2e']])}<radialGradient id="r" cx=".5" cy=".38" r=".5"><stop offset="0" stop-color="#e7c873" stop-opacity=".28"/><stop offset="1" stop-color="#e7c873" stop-opacity="0"/></radialGradient></defs><rect width="800" height="1400" fill="url(#g)"/><rect width="800" height="1400" fill="url(#r)"/>${a}<line x1="400" y1="0" x2="400" y2="170" stroke="#e7c873" stroke-opacity=".6"/><circle cx="400" cy="205" r="22" fill="#f3dfa2" opacity=".85"/>`)); } },
  { id: 'mezquita', nombre: 'Mezquita al atardecer', css: () => uri(SVG(`<defs>${degradado('g', [[0, '#1b1442'], [.55, '#5a2f6b'], [.85, '#d9805a'], [1, '#f1b36a']])}</defs><rect width="800" height="1400" fill="url(#g)"/>${estrellas(35, 21, 520)}<g fill="#0b0a1f"><rect x="0" y="1180" width="800" height="220"/><path d="M180 1180 V1050 Q180 940 300 940 Q420 940 420 1050 V1180Z"/><rect x="296" y="900" width="8" height="40"/><path d="M440 1180 V1000 Q440 910 520 910 Q600 910 600 1000 V1180Z"/><rect x="104" y="760" width="26" height="420"/><path d="M96 760 L117 700 L138 760Z"/><rect x="652" y="700" width="30" height="480"/><path d="M642 700 L667 625 L692 700Z"/></g>${luna(520, 250, 46, '#ffe9b0')}`)) },
  { id: 'desierto', nombre: 'Dunas y luna', css: () => uri(SVG(`<defs>${degradado('g', [[0, '#0a1230'], [.65, '#27315f'], [1, '#6a5a78']])}</defs><rect width="800" height="1400" fill="url(#g)"/>${estrellas(60, 5, 780)}${luna(250, 260, 58)}<path d="M0 1060 Q200 960 420 1040 T800 1000 V1400 H0Z" fill="#1a1d3c"/><path d="M0 1180 Q260 1090 520 1170 T800 1150 V1400 H0Z" fill="#0f1128"/>`)) },
  { id: 'arabesco', nombre: 'Arabesco', css: () => { let t = ''; for (let y = -40; y < 1440; y += 70) for (let x = (Math.round(y / 70) % 2) * 40 - 40; x < 840; x += 80) t += `<circle cx="${x}" cy="${y}" r="40" fill="none" stroke="#c9b6ff" stroke-opacity=".16" stroke-width="1.4"/>`; return uri(SVG(`<defs>${degradado('g', [[0, '#14082f'], [1, '#2a1650']])}</defs><rect width="800" height="1400" fill="url(#g)"/>${t}`)); } },
  { id: 'liso', nombre: 'Liso', css: () => 'linear-gradient(#07061c,#16143a)' }
];
export const FONDO_PROPIO = 'propio';

// ---- Fondo propio en IndexedDB (sólo en este dispositivo) ------------------------------------
const BD = 'qescucha', ALMACEN = 'fondo';
function abrir() {
  return new Promise((ok, no) => {
    if (!globalThis.indexedDB) return no(new Error('sin IndexedDB'));
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ALMACEN);
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
export async function guardarFondoPropio(blob) {
  const bd = await abrir();
  return new Promise((ok, no) => { const t = bd.transaction(ALMACEN, 'readwrite'); t.objectStore(ALMACEN).put(blob, 'imagen'); t.oncomplete = ok; t.onerror = () => no(t.error); });
}
export async function leerFondoPropio() {
  try {
    const bd = await abrir();
    return await new Promise((ok, no) => { const q = bd.transaction(ALMACEN).objectStore(ALMACEN).get('imagen'); q.onsuccess = () => ok(q.result || null); q.onerror = () => no(q.error); });
  } catch (e) { return null; }
}
// Reduce la imagen elegida (máx. 1600 px por lado) para no gastar memoria ni almacenamiento.
export async function prepararImagen(archivo) {
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('imagen no válida')), 'image/jpeg', .84));
}
