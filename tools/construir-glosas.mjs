#!/usr/bin/env node
// Genera los glosarios estáticos de Al-Baqarah (data/al-baqarah/*.json) a partir de
// los borradores de autoría en tools/glosas-es/*.txt y de la segmentación de
// referencia de Quran.com guardada en data/fuentes/quran-com-al-baqarah.json.
//
// Formato de cada línea de borrador:
//   16: aquellos | son quienes | compraron | ...
// Una celda por palabra de Quran.com, en orden de lectura (posición 1, 2, ...).
// Para marcar una glosa que necesita revisión humana, añadir al final de la celda
//   [? motivo de la duda]
// Las líneas que empiezan con # son comentarios.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(root, 'tools/glosas-es');
const OUT_DIR = path.join(root, 'data/al-baqarah');
const source = JSON.parse(fs.readFileSync(path.join(root, 'data/fuentes/quran-com-al-baqarah.json'), 'utf8'));

// Transliteración aproximada para hispanohablantes: misma conversión que el lector
// (función trES de index.html) aplicada a la transliteración de Quran.com.
export function trES(s) {
  return String(s || '').replace(/[āĀ]/g, 'a').replace(/[īĪ]/g, 'i').replace(/[ūŪ]/g, 'u')
    .replace(/ḥ/g, 'h').replace(/ṣ/g, 's').replace(/ḍ/g, 'd').replace(/ṭ/g, 't').replace(/ẓ/g, 'z')
    .replace(/[ʿʾʻ‘’]/g, "'").replace(/kh/gi, 'j').replace(/sh/gi, 'sh').replace(/gh/gi, 'g')
    .replace(/th/gi, 'z').replace(/dh/gi, 'd').replace(/-/g, '·');
}

export function parseDraft(text, file) {
  const verses = new Map();
  const errors = [];
  text.split(/\r?\n/).forEach((line, n) => {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) return;
    const m = raw.match(/^(\d+):\s*(.*)$/);
    if (!m) { errors.push(`${file}:${n + 1}: línea sin número de aleya`); return; }
    const num = Number(m[1]);
    if (verses.has(num)) errors.push(`${file}:${n + 1}: aleya ${num} repetida`);
    const cells = m[2].split('|').map(c => c.trim()).map(c => {
      const q = c.match(/^(.*?)\s*\[\?\s*(.*?)\s*\]$/);
      return q ? { es: q[1].trim(), revisar: q[2] || 'Revisar' } : { es: c };
    });
    verses.set(num, cells);
  });
  return { verses, errors };
}

// JSON legible: una palabra por línea.
function format(out) {
  const { aleyas, ...meta } = out;
  const head = JSON.stringify(meta, null, 1).replace(/\n}$/, '');
  const body = Object.entries(aleyas).map(([v, ws]) =>
    ` ${JSON.stringify(v)}: [\n${ws.map(w => '  ' + JSON.stringify(w)).join(',\n')}\n ]`).join(',\n');
  return `${head},\n "aleyas": {\n${body}\n }\n}\n`;
}

function build() {
  const files = fs.readdirSync(SRC_DIR).filter(f => /^2-\d{3}-\d{3}\.txt$/.test(f)).sort();
  const errors = [];
  const blocks = [];
  for (const file of files) {
    const [, from, to] = file.match(/^2-(\d{3})-(\d{3})\.txt$/).map(Number);
    const { verses, errors: e } = parseDraft(fs.readFileSync(path.join(SRC_DIR, file), 'utf8'), file);
    errors.push(...e);
    const aleyas = {};
    for (const [num, cells] of [...verses].sort((a, b) => a[0] - b[0])) {
      if (num < from || num > to) { errors.push(`${file}: aleya ${num} fuera del rango ${from}-${to}`); continue; }
      const ref = source.aleyas[num];
      if (!ref) { errors.push(`${file}: aleya ${num} no existe en la fuente`); continue; }
      if (cells.length !== ref.length) {
        errors.push(`${file}: 2:${num} tiene ${cells.length} glosas; Quran.com tiene ${ref.length} palabras`);
        continue;
      }
      aleyas[num] = ref.map((w, i) => {
        const entry = { pos: w.pos, ar: w.ar, tr: trES(w.translit), es: cells[i].es, estado: 'propuesta' };
        if (cells[i].revisar) entry.revisar = cells[i].revisar;
        return entry;
      });
    }
    const name = file.replace(/\.txt$/, '.json');
    const missing = [];
    for (let v = from; v <= to; v++) if (!aleyas[v]) missing.push(v);
    const out = {
      capitulo: 2,
      sura: 'Al-Baqarah',
      bloque: `${from}-${to}`,
      segmentacion: 'Quran.com (texto Uthmani, API v4); ver data/fuentes/quran-com-al-baqarah.json',
      estadoRevision: 'propuesta: glosas redactadas con asistencia de IA a partir del árabe y cotejadas con traducciones españolas reconocidas; pendientes de revisión humana. Las palabras con "revisar" tienen dudas de interpretación señaladas.',
      generado: 'tools/construir-glosas.mjs desde tools/glosas-es/' + file,
      aleyas,
    };
    fs.writeFileSync(path.join(OUT_DIR, name), format(out));
    blocks.push({ archivo: name, desde: from, hasta: to, aleyas: Object.keys(aleyas).map(Number), faltan: missing });
  }
  const covered = new Set(blocks.flatMap(b => b.aleyas));
  const index = {
    capitulo: 2,
    sura: 'Al-Baqarah',
    totalAleyas: 286,
    aleyasConGlosas: covered.size,
    estadoRevision: 'propuesta (pendiente de revisión humana)',
    bloques: blocks.map(({ archivo, desde, hasta }) => ({ archivo, desde, hasta })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  return { errors, blocks, covered };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { errors, covered } = build();
  console.log(`Aleyas con glosas: ${covered.size}/286`);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
}
