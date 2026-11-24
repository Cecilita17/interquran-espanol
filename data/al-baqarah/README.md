# Glosas interlineales en español — Al-Baqarah (2:1–2:286)

Glosarios estáticos palabra por palabra que el lector (`index.html`) carga sin consultar
servicios de traducción en tiempo real.

## Archivos

| Ruta | Contenido |
|---|---|
| `data/al-baqarah/index.json` | Manifiesto: lista de bloques y número de aleyas glosadas. |
| `data/al-baqarah/2-XXX-YYY.json` | Un bloque de aleyas. Cada palabra: `pos`, `ar` (Uthmani con tashkīl), `tr` (transliteración para hispanohablantes), `es` (significado), `estado` y, si hay dudas, `revisar`. |
| `data/al-baqarah/COBERTURA.md` | Informe de cobertura generado por el validador. |
| `data/fuentes/quran-com-al-baqarah.json` | Copia versionada de la segmentación de Quran.com (texto Uthmani y transliteración) usada como referencia. |
| `tools/glosas-es/2-XXX-YYY.txt` | **Fuente editable** de las glosas: una línea por aleya, una celda por palabra separada por `|`. |
| `tools/construir-glosas.mjs` | Genera los JSON a partir de los `.txt` y de la segmentación de Quran.com. |
| `tools/validar-glosas.mjs` | Validación automática (ver abajo). |
| `tools/probar-lector.mjs` | Prueba del lector en Chromium (Playwright). |

Los JSON se generan: para corregir una glosa, editar el `.txt` correspondiente y ejecutar
`node tools/construir-glosas.mjs`. Para señalar una duda, añadir al final de la celda
`[? motivo]`.

## Fuente y segmentación

- Texto árabe y segmentación: **Quran.com API v4** (`text_uthmani`, tokens `char_type_name = word`).
  La copia local es idéntica a Quran.com en vivo (comprobado con `--online`).
- Se cotejó con el texto Uthmani de **Al Quran Cloud** (`quran-uthmani`, que usa el lector para el
  texto completo de la aleya). Número y secuencia de palabras coinciden en las 286 aleyas. Diferencias
  documentadas, todas ortográficas o de tokenización, no de segmentación:
  1. Al Quran Cloud separa los signos de pausa (ۖ ۗ ۚ ۛ …) como tokens independientes; Quran.com los
     adjunta a la palabra anterior. Se resuelve ignorando los tokens sin letras.
  2. Al Quran Cloud escribe la madda inicial como `ءا` (p. ej. `ٱلْءَاخِرَةِ`) donde Quran.com usa
     `ـَٔا`; la normalización del lector las equipara.
  3. En Al Quran Cloud, la aleya 2:1 incluye la basmala delante de `الٓمٓ`; el lector la omite al alinear.
- Transliteración: conversión automática y aproximada de la transliteración de Quran.com
  (misma regla `trES` que ya usaba el lector).

## Criterios de traducción

- Significado natural en contexto, manteniendo la correspondencia palabra por palabra.
- Se conservan las partículas unidas a la palabra árabe: conjunciones (*wa-* «y», *fa-*
  «entonces / pues / así que»), preposiciones (*bi-*, *li-*, *ka-*), artículo y pronombres sufijos.
  Excepción deliberada: *wa-lahum* / *la-hum* posesivo se glosa «y tendrán» / «tendrán».
- Referencias contextuales: traducciones españolas reconocidas (Cortés, Isa García, Melara Navío).
  No se usaron Google Translate ni MyMemory. La traducción inglesa palabra por palabra de Quran.com
  se usó sólo para controles automáticos de alineación (nombres propios, «Allah», prefijos).
- Los casos con varias interpretaciones reconocidas llevan `revisar` y aparecen en `COBERTURA.md`.

## Estado de revisión

Todas las glosas tienen `estado: "propuesta"`: fueron redactadas con asistencia de IA y verificadas
automáticamente (alineación, segmentación, formato), **pero no han sido revisadas por una persona**.
Para marcar una palabra como revisada, cambiar `estado` a `revisada` y añadir `revisor` (el
validador rechaza `revisada` sin revisor). Las glosas de 2:1–2:15 que existían antes también se
revisaron y se reclasificaron como propuesta, porque tampoco tenían revisión humana registrada.

## Comandos

```sh
node tools/construir-glosas.mjs                          # regenerar JSON
node tools/validar-glosas.mjs --informe                  # validar y regenerar COBERTURA.md
NODE_USE_ENV_PROXY=1 node tools/validar-glosas.mjs --online   # comparar además con Quran.com en vivo
node tools/probar-lector.mjs [URL] [--sin-qdc]           # probar el lector (local o desplegado)
```
