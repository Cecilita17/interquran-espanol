#!/usr/bin/env node
// Validación de los glosarios estáticos de Al-Baqarah.
//   node tools/validar-glosas.mjs            -> validación completa (falla si faltan aleyas)
//   node tools/validar-glosas.mjs --parcial  -> sólo valida las aleyas presentes (trabajo por bloques)
//   node tools/validar-glosas.mjs --online   -> además compara la copia local con Quran.com en vivo
//   node tools/validar-glosas.mjs --informe  -> además escribe data/al-baqarah/COBERTURA.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDraft, trES } from './construir-glosas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const PARTIAL = args.has('--parcial');
const errors = [];
const warnings = [];
const fail = m => errors.push(m);

function readJSON(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); }
  catch (e) { fail(`JSON inválido o ausente: ${rel} (${e.message})`); return null; }
}

// 1. Fuente de segmentación (copia local de Quran.com).
const source = readJSON('data/fuentes/quran-com-al-baqarah.json');
if (!source) { console.error(errors.join('\n')); process.exit(1); }
const sourceVerses = Object.keys(source.aleyas).map(Number);
if (sourceVerses.length !== 286 || sourceVerses.some((v, i) => v !== i + 1)) fail('La fuente local no contiene exactamente las aleyas 1–286');
for (const [v, words] of Object.entries(source.aleyas)) {
  words.forEach((w, i) => { if (w.pos !== i + 1) fail(`Fuente 2:${v}: posición ${w.pos} fuera de orden`); });
}

if (args.has('--online')) {
  const live = {};
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`https://api.quran.com/api/v4/verses/by_chapter/2?words=true&word_fields=text_uthmani&per_page=50&page=${page}`);
    if (!r.ok) { fail(`Quran.com no respondió (${r.status})`); break; }
    const d = await r.json();
    for (const v of d.verses) live[v.verse_number] = v.words.filter(w => w.char_type_name === 'word').map(w => w.text_uthmani);
    if (!d.pagination?.next_page) break;
  }
  for (let v = 1; v <= 286; v++) {
    const a = (source.aleyas[v] || []).map(w => w.ar).join(' ');
    const b = (live[v] || []).join(' ');
    if (a !== b) fail(`2:${v}: la copia local difiere de Quran.com en vivo`);
  }
  if (!errors.length) console.log('✓ Copia local idéntica a Quran.com en vivo (286 aleyas)');
}

// 2. Manifiesto y bloques.
const index = readJSON('data/al-baqarah/index.json');
const placeholders = /^(—|-|–|\?|\.\.\.|…|undefined|null|nan|n\/a|traduciendo…?|ver traducción de la aleya)$/i;
const placeholderAnywhere = /(undefined|\bnull\b|ver traducción de la aleya|traduciendo…|\[\?)/i;
const devMarkers = /\b(TODO|XXX|FIXME)\b/;
const english = /\b(the|of|and|they|them|their|who|which|those|indeed|verily|is|are|was|were|will|would|you|your|we|our|with|from|for|that|this|what|allah|lord|believe[ds]?|people|it|his|him|she|her)\b/i;
const verses = new Map();
const reviewFlags = [];
if (index) {
  if (index.totalAleyas !== 286) fail('index.json: totalAleyas debe ser 286');
  for (const b of index.bloques || []) {
    const data = readJSON('data/al-baqarah/' + b.archivo);
    if (!data) continue;
    for (const [k, words] of Object.entries(data.aleyas || {})) {
      const v = Number(k);
      if (v < b.desde || v > b.hasta) fail(`${b.archivo}: aleya ${v} fuera de su rango`);
      if (verses.has(v)) fail(`2:${v} aparece en más de un archivo`);
      verses.set(v, { words, file: b.archivo });
    }
  }
  if (index.aleyasConGlosas !== verses.size) fail(`index.json declara ${index.aleyasConGlosas} aleyas y hay ${verses.size}`);
}

// 3. Comprobaciones por aleya y por palabra.
const missing = [];
for (let v = 1; v <= 286; v++) {
  const entry = verses.get(v);
  const ref = source.aleyas[v];
  if (!entry) { missing.push(v); continue; }
  const { words } = entry;
  const where = `2:${v}`;
  if (!Array.isArray(words)) { fail(`${where}: no es una lista`); continue; }
  if (words.length !== ref.length) fail(`${where}: ${words.length} palabras; Quran.com tiene ${ref.length}`);
  const seenPos = new Set();
  words.forEach((w, i) => {
    const at = `${where}:${i + 1}`;
    if (w.pos !== i + 1) fail(`${at}: posición ${w.pos} fuera de orden (se esperaba ${i + 1})`);
    if (seenPos.has(w.pos)) fail(`${at}: posición duplicada`);
    seenPos.add(w.pos);
    const r = ref[i];
    if (!r) { fail(`${at}: palabra sobrante (duplicada o inventada)`); return; }
    if (w.ar !== r.ar) fail(`${at}: el árabe no coincide con Quran.com («${w.ar}» ≠ «${r.ar}»)`);
    if (w.tr !== trES(r.translit)) fail(`${at}: transliteración no corresponde a la palabra`);
    const es = typeof w.es === 'string' ? w.es.trim() : '';
    if (!es) fail(`${at}: glosa vacía`);
    else {
      if (placeholders.test(es) || placeholderAnywhere.test(es) || devMarkers.test(es)) fail(`${at}: placeholder en la glosa («${es}»)`);
      if (english.test(es)) fail(`${at}: posible glosa en inglés («${es}»)`);
      if (/[؀-ۿ]/.test(es)) fail(`${at}: la glosa contiene árabe`);
    }
    if (!['propuesta', 'revisada'].includes(w.estado)) fail(`${at}: estado desconocido «${w.estado}»`);
    if (w.estado === 'revisada' && !w.revisor) fail(`${at}: marcada como revisada sin indicar revisor humano`);
    if (w.revisar) reviewFlags.push({ v, pos: i + 1, ar: w.ar, es, nota: w.revisar });
    // Duplicados accidentales: misma glosa en palabras contiguas con árabe distinto.
    const prev = words[i - 1];
    if (prev && prev.es === w.es && prev.ar !== w.ar) fail(`${at}: glosa repetida respecto a la palabra anterior («${es}»)`);
  });
  const prevVerse = verses.get(v - 1);
  if (prevVerse && words.length > 3 && prevVerse.words.map(w => w.es).join('|') === words.map(w => w.es).join('|')) fail(`${where}: glosas idénticas a 2:${v - 1} (¿copia accidental?)`);
}
if (missing.length && !PARTIAL) fail(`Faltan ${missing.length} aleyas: ${compress(missing)}`);

// 4. Los JSON generados coinciden con los borradores de autoría.
const draftDir = path.join(root, 'tools/glosas-es');
for (const f of fs.readdirSync(draftDir).filter(f => f.endsWith('.txt'))) {
  const { verses: draft, errors: e } = parseDraft(fs.readFileSync(path.join(draftDir, f), 'utf8'), f);
  e.forEach(fail);
  for (const [v, cells] of draft) {
    const built = verses.get(v);
    if (!built) { fail(`${f}: 2:${v} no está en los JSON generados (ejecutar tools/construir-glosas.mjs)`); continue; }
    if (cells.map(c => c.es).join('|') !== built.words.map(w => w.es).join('|')) fail(`${f}: 2:${v} desactualizada en JSON (ejecutar tools/construir-glosas.mjs)`);
  }
}

// 5. El lector usa los nuevos archivos.
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!html.includes('/data/al-baqarah/index.json')) fail('index.html no carga data/al-baqarah/index.json');
if (/al-baqarah-es(-11-15)?\.json/.test(html)) fail('index.html todavía referencia los glosarios antiguos');
if (!/entry\.tr/.test(html)) fail('index.html no usa la transliteración estática (entry.tr)');

// 6. Informe.
const complete = [...verses.keys()].sort((a, b) => a - b);
const flaggedVerses = [...new Set(reviewFlags.map(f => f.v))];
const totalWords = complete.reduce((n, v) => n + verses.get(v).words.length, 0);
console.log(`Aleyas con glosas: ${complete.length}/286 · palabras: ${totalWords} · aleyas con dudas señaladas: ${flaggedVerses.length}`);
if (missing.length) console.log(`Pendientes: ${compress(missing)}`);
if (args.has('--informe')) writeReport();
if (warnings.length) console.warn(warnings.join('\n'));
if (errors.length) { console.error('✗ ' + errors.length + ' errores\n' + errors.slice(0, 200).join('\n')); process.exit(1); }
console.log('✓ Validación superada' + (PARTIAL ? ' (modo parcial)' : ''));

function compress(list) {
  const out = []; let s = null, p = null;
  for (const n of list) { if (s === null) { s = p = n; } else if (n === p + 1) p = n; else { out.push(s === p ? `${s}` : `${s}–${p}`); s = p = n; } }
  if (s !== null) out.push(s === p ? `${s}` : `${s}–${p}`);
  return out.join(', ');
}

function writeReport() {
  const reviewed = complete.filter(v => verses.get(v).words.every(w => w.estado === 'revisada'));
  const lines = [
    '# Cobertura de glosas — Al-Baqarah (2:1–2:286)', '',
    '_Generado por `node tools/validar-glosas.mjs --informe`._', '',
    `- Aleyas con glosas completas y alineadas con Quran.com: **${complete.length}/286** (${compress(complete) || '—'})`,
    `- Palabras glosadas: **${totalWords}**`,
    `- Aleyas pendientes: ${missing.length ? compress(missing) : 'ninguna'}`,
    `- Aleyas revisadas por una persona: **${reviewed.length}** ${reviewed.length ? '(' + compress(reviewed) + ')' : ''}`,
    `- Aleyas con glosas en estado «propuesta»: **${complete.length - reviewed.length}**`,
    `- Aleyas con dudas de interpretación señaladas: **${flaggedVerses.length}** (${compress(flaggedVerses) || 'ninguna'})`, '',
    '## Estado de revisión', '',
    'Todas las glosas fueron redactadas con asistencia de IA a partir del texto árabe, palabra por palabra,',
    'tomando como referencia contextual traducciones españolas reconocidas (Cortés, Isa García, Melara Navío)',
    'y la segmentación de Quran.com. **Ninguna ha sido revisada todavía por una persona**: su estado es',
    '`propuesta`. Para marcar una palabra como revisada, cambiar `estado` a `revisada` e indicar `revisor`.', '',
    '## Glosas que necesitan revisión humana', '',
    '| Aleya | Pos. | Árabe | Glosa propuesta | Motivo |', '|---|---|---|---|---|',
    ...reviewFlags.map(f => `| 2:${f.v} | ${f.pos} | ${f.ar} | ${f.es} | ${f.nota} |`), '',
  ];
  fs.writeFileSync(path.join(root, 'data/al-baqarah/COBERTURA.md'), lines.join('\n'));
}
