#!/usr/bin/env node
// Genera data/suras.json (número → carpeta de glosas, nombre, significado en español, nº de aleyas)
// a partir de tools/suras.mjs y de SURA_ES de index.html, para que «Escucha inmersiva» no duplique
// a mano esos datos. Ejecutar tras añadir o renombrar suras.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURAS } from './suras.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/const SURA_ES=(\{[^}]*\});/);
if (!m) throw new Error('No se encontró SURA_ES en index.html');
const es = new Function('return ' + m[1])();
const out = {};
for (const [n, s] of Object.entries(SURAS)) out[n] = { slug: s.slug, nombre: s.nombre, es: es[n] || '', aleyas: s.aleyas };
fs.writeFileSync(path.join(root, 'data/suras.json'), JSON.stringify(out) + '\n');
console.log('data/suras.json:', Object.keys(out).length, 'suras');
