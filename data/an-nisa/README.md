# Glosas interlineales en español — An-Nisa (4:1–4:176)

Mismo método, formato y herramientas que Al-Baqarah: ver `data/al-baqarah/README.md`.
Las suras con glosario están declaradas en `tools/suras.mjs` y en `FIXED_GLOSSES` de `index.html`.

| Ruta | Contenido |
|---|---|
| `data/an-nisa/index.json` y `4-XXX-YYY.json` | Glosas generadas (176 aleyas, 3.747 palabras). |
| `data/an-nisa/COBERTURA.md` | Informe de cobertura y dudas señaladas. |
| `data/fuentes/quran-com-an-nisa.json` | Segmentación de referencia de Quran.com. |
| `tools/glosas-es/4-XXX-YYY.txt` | Fuente editable de las glosas. |

## Fuente y segmentación

Quran.com (API v4, `text_uthmani`) y Al Quran Cloud (`quran-uthmani`) coinciden en número y
secuencia de palabras en las 176 aleyas tras la misma normalización que usa el lector (signos de
pausa como tokens aparte, madda escrita `ءا`, basmala delante de 4:1 en Al Quran Cloud). La copia
local es idéntica a Quran.com en vivo (`--online`).

## Estado de revisión

Todas las glosas están en estado `propuesta`: redactadas con asistencia de IA a partir del árabe,
con traducciones españolas reconocidas como referencia contextual, y verificadas automáticamente
(alineación, segmentación, nombres propios, partículas unidas). Ninguna tiene revisión humana. Las
13 aleyas con dudas de interpretación señaladas figuran en `COBERTURA.md`.
