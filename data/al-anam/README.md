# Glosas interlineales en español — Al-An'am (6:1–6:165)

Mismo método, formato y herramientas que Al-Baqarah: ver `data/al-baqarah/README.md`.
Las suras con glosario están declaradas en `tools/suras.mjs` y en `FIXED_GLOSSES` de `index.html`.

| Ruta | Contenido |
|---|---|
| `data/al-anam/index.json` y `6-XXX-YYY.json` | Glosas generadas (165 aleyas, 3.050 palabras). |
| `data/al-anam/COBERTURA.md` | Informe de cobertura y dudas señaladas. |
| `data/fuentes/quran-com-al-anam.json` | Segmentación de referencia de Quran.com. |
| `tools/glosas-es/6-XXX-YYY.txt` | Fuente editable de las glosas. |

## Fuente y segmentación

Quran.com (API v4, `text_uthmani`) y Al Quran Cloud (`quran-uthmani`) coinciden en número y
secuencia de palabras en las 165 aleyas tras la misma normalización que usa el lector (signos de
pausa como tokens aparte, madda escrita `ءا`, basmala delante de 6:1 en Al Quran Cloud). La copia
local es idéntica a Quran.com en vivo (`--online`).

## Estado de revisión

Todas las glosas están en estado `propuesta`: redactadas con asistencia de IA a partir del árabe,
con traducciones españolas reconocidas como referencia contextual, y verificadas automáticamente
(alineación, segmentación, nombres propios, partículas unidas). Ninguna tiene revisión humana. Las
4 aleyas con dudas de interpretación señaladas figuran en `COBERTURA.md`.
