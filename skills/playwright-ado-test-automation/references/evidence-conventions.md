# Convenciones de evidencia

## Carpetas
| Ambiente | Evidencia | Resultados | Reporte |
|---|---|---|---|
| `test` (por defecto) | `evidence-validacion/` | `test-results/` | `playwright-report/` |
| `<nombre>` | `evidence-validacion/<nombre>/` | `test-results-<nombre>/` | `playwright-report-<nombre>/` |

Una corrida abortada que quieras conservar se mueve a `evidence-validacion/<env>/_corrida-<n>-<motivo>/`
(el prefijo `_` y la subcarpeta hacen que `qa-validate.py` la ignore).

## Qué se guarda según `EVIDENCE_CAPTURE`
| Evidencia | `always` | `on-failure` (defecto) | `off` |
|---|---|---|---|
| JSON (`request`, `response`, `resultado`) con claves sensibles en `***` | sí | sí | sí |
| Archivos de entrada (`input.csv`…) | sí | sí | sí |
| Capturas `.png` (con máscaras) | todas | solo tests fallidos | no |
| Video `.webm` | todos | solo tests fallidos | no |
| Traza `trace.zip` (nunca se adjunta a ADO) | solo fallidos | solo fallidos | no |

Con `on-failure` las capturas se toman durante el test (no se sabe aún si va a fallar) y el
fixture de `lib/fixtures.js` las borra al terminar si pasó. Por eso los tests deben importar
`test` desde `./lib/fixtures.js`.

Cuando el usuario pide evidencia visual siempre, el valor `always` se deja en `env` y en
`env.example`: es una decisión del equipo, no de una corrida.

## Nombre de archivo
```
<ts>-TC-<id>[-<variante>]-<tipo>.<ext>
```
- `<ts>`: `new Date().toISOString()` sin milisegundos, con `:` y `.` → `-` (`2026-01-15T10-20-30`).
- `<variante>`: el valor del parámetro o el nombre del escenario, pasado por `slug()`. Es el
  mismo texto para todos los archivos de la ejecución. Ejemplos: `51`, `0registros`,
  `formato-pdf`, `nuevaLatitudOrigen--90.1`, `sin-iniciar`.
- `<tipo>`:

| Tipo | Variante | Contenido |
|---|---|---|
| `swagger-01-request.png` | API | Swagger con el body armado, antes de Execute |
| `swagger-02-response.png` | API | Swagger con "Server response" visible |
| `request.json` | API | Body enviado (claves sensibles en `***`) |
| `response.json` | API | `{ status, duration, body, requestUrl }` (claves sensibles en `***`) |
| `input.csv` (u otra ext.) | UI | Archivo exacto subido |
| `pantalla.png` | UI | Pantalla después de leer el resultado |
| `resultado.json` | UI | `{ variante, filas, aviso: {title,text}|null, resultado: {enviados,exitosos,fallidos}|null, botonHabilitado }` |
| `plantilla.csv` | UI | Plantilla descargada (casos de descarga) |

Videos (`.webm`) los genera Playwright en `test-results*/`; `qa-validate.py` los adjunta como
`TC-<id>-<slug-del-título>[-intentoN].webm`.

## Por qué un único `startEvidence` por ejecución
`qa-validate.py` agrupa por `<ts>-TC-<id>[-<variante>]`. Si la captura y el JSON se nombran por
separado (cada uno con su `ts()` o con variantes escritas distinto, p. ej. `Existente` en la
captura y `ubicacionExistente` en el JSON), la misma ejecución aparece partida en dos y el
resumen muestra ejecuciones fantasma ("0 ítems, HTTP None"). Crear la evidencia una vez y
escribir todo por ella elimina el problema por construcción.

## Qué NO es evidencia
- La preparación de datos (crear/consultar fixtures) salvo que el caso la pida.
- `error-context.md`, trazas y reportes HTML de Playwright: sirven para depurar, pero pueden
  contener el token (ver `security.md`); no se adjuntan a ADO.
