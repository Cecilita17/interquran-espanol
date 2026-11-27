# Escucha inmersiva

Pantalla independiente (`/escucha.html`) para aprender el árabe coránico escuchando: una aleya por pantalla,
con la traducción natural arriba, las palabras árabes (RTL) con transliteración y significado debajo, y una
barra flotante de reproducción. **No sustituye ni modifica el lector interlineal** (`index.html`): sólo se
añadieron dos enlaces de entrada (portada y cabecera del lector) y un `<script>` final con un `onclick`.

## Arquitectura

| Archivo | Papel |
|---|---|
| `escucha.html`, `escucha/escucha.css` | Estructura y estilos (glassmorphism, móvil primero, PWA). |
| `escucha/app.js` | Interfaz: preferencias, hojas de configuración, resaltado, Media Session, progreso. |
| `escucha/motor.js` | **Máquina de estados** (`inactivo → cargando → reproduciendo ⇄ pausado → terminado/error`) y construcción del plan de pasos por aleya. Sin DOM: se prueba con un controlador simulado. |
| `escucha/audio.js` | Controlador de audio: **un solo `Audio`**; clips con marcas reales, voz de la traducción y voz del dispositivo. Cada operación se resuelve con `ok / cancelado / error / bloqueado / omitido`. |
| `escucha/segmentos.js` | Validación estricta de las marcas de tiempo de Quran.com y cálculo de la palabra activa. Nunca inventa tiempos. |
| `escucha/datos.js` | Carga de datos reutilizando las fuentes existentes. |
| `escucha/fondos.js` | Fondos SVG de temática islámica + imagen propia (IndexedDB, sólo en el dispositivo). |
| `data/suras.json` | Índice (carpeta, nombre, significado, nº de aleyas) generado por `tools/generar-indice-suras.mjs`. |

### Fuentes de datos (nada se duplica)

* Palabras (árabe con tashkīl, transliteración, significado): `data/<sura>/` — las mismas glosas del lector (estado *propuesta*).
* Traducción natural: Al Quran Cloud `es.cortes` / `es.garcia`, igual que el lector.
* Audio y marcas por palabra: Quran.com, recitaciones 7 (Mishary Rashid Alafasy) y 10 (Saud Al-Shuraim), como el lector.
* Voz de la traducción: `/api/tts` (voces neuronales); si falla, voz del dispositivo.
* Significado de cada palabra: voz del dispositivo (el servidor sólo sintetiza traducciones de aleyas completas; no se abrió un TTS de texto libre).

### Modos

1. **Traducción + recitación**: traducción hablada → recitación completa.
2. **Palabra por palabra**: para cada palabra, primero su significado en español (voz) y después la palabra en árabe (clip real de la recitación, marcas reales).
3. **Combinada**: traducción completa → palabra por palabra (significado, luego árabe) → recitación completa.
4. **Sólo recitación** con resaltado sincronizado.

«Repeticiones por palabra» repite el par (significado + árabe). «Repeticiones por aleya» repite la recitación
completa (en el modo 2, el recorrido palabra por palabra). Las pausas entre audios son configurables.

## Sincronización: reglas

* El resaltado y los clips se calculan **sólo** con los segmentos `[palabraDesde, palabraHasta, msInicio, msFin]` de
  Quran.com del **mismo recitador y aleya** cuyo audio se reproduce.
* Una aleya es «fiable» para palabra por palabra sólo si hay exactamente un segmento por palabra, en orden, sin
  solapes ni tiempos inválidos (`segmentos.js`). Si no, se **desactiva palabra por palabra en esa aleya** y se informa; se
  reproduce la recitación completa auténtica (con resaltado por rangos si las marcas cubren todo en orden).
* Cada clip termina en el inicio de la palabra siguiente o, como mucho, `COLA_MS` (250 ms) después de su fin real, para no
  cortar la pronunciación. La última palabra incluye esa misma cola.
* El texto coránico sólo se oye en grabaciones auténticas; nunca TTS.

Cobertura medida con `node tools/verificar-segmentos.mjs` (noviembre de 2026): Alafasy 6.187/6.236 aleyas fiables
(99,2 %); Shuraym 6.180/6.236 (99,1 %). El resto cae en el comportamiento descrito arriba.

## Preferencias y progreso

`localStorage`: `qescucha-prefs` y `qescucha-progreso` (última aleya y aleyas escuchadas por sura). Son independientes de
`qpositions`, `qposition`, `qread`, etc. del lector, que la escucha inmersiva nunca escribe (sólo lee `qvoice` y `qtrans`
como valores iniciales). El fondo propio va a IndexedDB (`qescucha`).

## Segundo plano y Android

* Se usa Media Session (metadatos, `play`, `pause`, `previoustrack`, `nexttrack`, `seekbackward/forward` → aleya anterior/siguiente, `stop`)
  y un único `Audio`, que es lo que permite a Chrome mantener la sesión con la pantalla apagada.
* **Limitación:** `speechSynthesis` (significado de cada palabra) suele no sonar con la página oculta o la pantalla bloqueada
  en Android. Por eso, con la página oculta se omiten esos pasos (y hay un vigilante de 2,5 s que evita bloqueos). La
  traducción (mp3), los clips y la recitación sí son audio normal.
* Los navegadores exigen un gesto del usuario para iniciar el audio: si lo bloquean, el motor pasa a «pausado» y avisa.
* **No verificado en un dispositivo Android real** (ver abajo): conviene probarlo con la pantalla apagada y con otra app en primer plano.

## Pruebas

```
node --test tools/probar-motor.mjs      # máquina de estados, plan por modo, validación de marcas (sin red ni navegador)
node tools/probar-escucha.mjs           # Chromium: RTL, sincronía contra el reloj del audio, repeticiones, pausas, persistencia,
                                        # Media Session, aislamiento del lector, pantallas pequeñas (red simulada)
node tools/probar-lector.mjs            # lector tradicional (regresión)
NODE_USE_ENV_PROXY=1 node tools/verificar-segmentos.mjs   # fiabilidad de las marcas reales (requiere api.quran.com)
```
