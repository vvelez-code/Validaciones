# Pruebas exploratorias

Complementan a los TC formales: buscan comportamientos que los casos no cubren. No marcan ADO;
su entregable es un **reporte HTML de hallazgos** que el equipo puede convertir en bugs o en
nuevos casos.

## Cómo
1. Copia `assets/templates/exploratory-tests/` a la suite y renombra `explore.template.mjs`
   → `explore.mjs`. Usa `chromium`/`request` directamente (sin test runner) para que un
   escenario inesperado no corte la corrida.
2. Por cada escenario: prepara la entrada, guárdala (`guardar`), ejecuta, captura si es UI y
   llama a `registrar({...})` con esperado vs observado.
3. `node exploratory-tests/explore.mjs` genera `evidence[-<env>]/resultados-exploratorio.json`
   y `reporte-exploratorio[-<env>].html` (plantilla con tema claro/oscuro, tarjetas por
   escenario, capturas con lightbox y enlaces a las entradas exactas).

## Esquema de cada escenario
```json
{ "escenario": "coma-dentro-de-campo", "descripcion": "...", "esperado": "...", "observado": "...",
  "veredicto": "correcto|bug|observacion|informativo", "severidad": "alta|media|baja|",
  "hallazgo": "texto si es bug/observación", "evidencias": ["evidence/....csv", "evidence/....png"] }
```
- **bug**: el sistema hace algo incorrecto (acepta lo que debería rechazar, 5xx, dato corrupto).
- **observacion**: funciona pero confunde (mensaje engañoso, campo ignorado en silencio).
- **informativo**: comportamiento a documentar, sin juicio.
- **correcto**: confirma una regla.

## Ideas de escenarios que suelen encontrar algo
- Archivos: separador dentro de un campo entre comillas, encabezados en mayúsculas/espacios,
  columnas reordenadas, BOM/sin BOM, filas vacías al final, extensión correcta con contenido de
  otro formato.
- Datos: coordenadas `(0,0)`, límites ±90/±180 exactos, fechas fin < inicio, mismo día,
  zonas horarias, textos con emojis o 500+ caracteres, IDs repetidos en el mismo lote.
- Combinaciones: campo que debería ignorarse según el tipo (p. ej. `rutaId` con
  `tipoUbicacion=1`) — ¿se ignora en silencio o se valida?
- API: método equivocado, `Content-Type` faltante, lote vacío, `null` en vez de `[]`.

Cada hallazgo debe poder reproducirse con la entrada guardada: por eso se guarda siempre.
