#!/usr/bin/env node
// Mide, para las 114 suras y los dos recitadores, cuántas aleyas tienen marcas de tiempo
// FIABLES (una por palabra, en orden) comparando con el número de palabras de data/<sura>/.
// Requiere red hacia api.quran.com (NODE_USE_ENV_PROXY=1 tras el proxy del entorno).
//   node tools/verificar-segmentos.mjs [--sura N] [--recitador 7|10]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURAS } from './suras.mjs';
import { evaluarSegmentos } from '../escucha/segmentos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = k => argv.includes(k) ? argv[argv.indexOf(k) + 1] : null;
const suras = arg('--sura') ? [Number(arg('--sura'))] : Object.keys(SURAS).map(Number);
const recitadores = arg('--recitador') ? [Number(arg('--recitador'))] : [7, 10];

function palabrasLocales(slug) {
  const idx = JSON.parse(fs.readFileSync(path.join(root, 'data', slug, 'index.json'), 'utf8'));
  const out = {};
  for (const b of idx.bloques) {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'data', slug, b.archivo), 'utf8'));
    for (const [n, w] of Object.entries(j.aleyas)) out[n] = w.length;
  }
  return out;
}
async function segmentos(rec, sura) {
  const out = {};
  for (let page = 1; page < 20; page++) {
    let r, intentos = 0;
    while (true) {
      try { r = await fetch(`https://api.quran.com/api/v4/recitations/${rec}/by_chapter/${sura}?fields=segments&per_page=50&page=${page}`); if (r.ok) break; } catch (e) {}
      if (++intentos > 3) throw new Error(`Quran.com no responde (rec ${rec}, sura ${sura})`);
      await new Promise(ok => setTimeout(ok, 800 * intentos));
    }
    const d = await r.json();
    for (const f of d.audio_files || []) out[f.verse_key.split(':')[1]] = f;
    if (!d.pagination?.next_page) break;
  }
  return out;
}

const total = { 7: { aleyas: 0, fiables: 0, agrupadas: 0, sin: 0, malas: [] }, 10: { aleyas: 0, fiables: 0, agrupadas: 0, sin: 0, malas: [] } };
for (const rec of recitadores) {
  for (const s of suras) {
    const local = palabrasLocales(SURAS[s].slug), seg = await segmentos(rec, s), t = total[rec];
    for (const [n, np] of Object.entries(local)) {
      t.aleyas++;
      const f = seg[n];
      const ev = evaluarSegmentos(f?.segments, np);
      if (ev.fiable) t.fiables++;
      else { if (ev.rangos) t.agrupadas++; else t.sin++; if (t.malas.length < 400) t.malas.push(`${s}:${n} (${np} palabras): ${ev.motivo}`); }
    }
    process.stderr.write(`rec ${rec} sura ${s}\r`);
  }
}
for (const rec of recitadores) {
  const t = total[rec];
  console.log(`\nRecitación ${rec}: ${t.fiables}/${t.aleyas} aleyas con marcas fiables · agrupadas ${t.agrupadas} · inutilizables ${t.sin}`);
  for (const m of t.malas.slice(0, 40)) console.log('  ' + m);
}
