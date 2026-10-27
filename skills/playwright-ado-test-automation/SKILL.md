---
name: playwright-ado-test-automation
description: 'Automatiza casos de prueba de Azure DevOps Test Plans con Playwright y deja evidencia de QA. Úsala SIEMPRE que el pedido mencione un caso de prueba, TC, test case, test point, test plan o suite de Azure DevOps/ADO y haya que automatizarlo, ejecutarlo o re-ejecutarlo en un ambiente, dejar evidencia (capturas de Swagger o de la pantalla, request/response, video) o marcar el resultado passed/failed en ADO con adjuntos; también cuando QA pida evidencia de pruebas de un endpoint desde Swagger, o pruebas exploratorias de casos borde con reporte de hallazgos sobre un plan de pruebas, aunque no se nombre Playwright. Ejemplos: "automatiza el TC-1234 de la suite 56", "automate test cases from our Azure DevOps test plan". No la uses para Playwright genérico sin casos de ADO (tests e2e sueltos, CI o sharding, depurar locators, scraping, migrar desde Cypress), pipelines de ADO o publicar JUnit con PublishTestResults, WIQL o Boards, Postman, ni para solo redactar o crear casos de prueba sin automatizarlos.'
---

# Automatización de casos de prueba con Playwright + Azure DevOps

El objetivo es que, partiendo de uno o varios casos de prueba reales de ADO, cualquier persona
termine con **el mismo tipo de proyecto de validación**: ejecutable por ambiente, con evidencia
que un revisor puede abrir y entender sin preguntar nada, y con el resultado reflejado en los
Test Points de ADO. La calidad se mide por tres cosas: que la prueba verifique lo que el caso
dice (no algo parecido), que la evidencia demuestre lo que pasó, y que nada sensible quede
escrito en el proyecto.

## Resultado esperado (estructura del proyecto)

```
<nombre-suite>/
├── package.json                 # Playwright Test, ESM
├── playwright.config.js         # 1 worker, reporters html+list+json, carpetas por ambiente
├── env.example                  # plantilla comentada; env y env.<nombre> NUNCA se versionan
├── .gitignore
├── test-cases.json              # TC → Point, nombres, pasos y parámetros (fuente: ADO)
├── qa-validate.py               # ejecuta, decide outcome, resume y marca ADO
├── FLUJO-VALIDACION.md          # documento maestro de la suite
├── playwright-tests/
│   ├── lib/config.js            # carga env.<ambiente>, cfg() obligatoria
│   ├── lib/evidence.js          # nombres y escritura de evidencia
│   ├── lib/swagger.js           # (variante API) ejecución en Swagger UI con capturas
│   └── <suite>.spec.js          # un test por TC (o un for por parámetro)
├── exploratory-tests/           # (opcional) casos borde + reporte HTML de hallazgos
├── evidence-validacion/[<env>/] # generado
├── test-results[-<env>]/        # generado: playwright-results.json, resumen-<suite>.json
└── playwright-report[-<env>]/   # generado
```

En los comandos, `<skill>` es el directorio donde está este SKILL.md. Las plantillas de todo
esto están en `<skill>/assets/templates/`. Cópialas y adáptalas; no las
reescribas desde cero, porque ya resuelven problemas que costó descubrir (emparejamiento de
evidencias, último intento con retries, enmascarado del token en capturas, ambientes sin
mezcla de datos).

## Flujo de trabajo

### 1. Reunir los casos reales — no inventarlos
Necesitas organización, proyecto, Plan ID, Suite ID y los TC. Si hay acceso a ADO (variable
`ADO_PAT`), ejecuta:

```bash
python <skill>/scripts/ado_fetch_cases.py --org <ORG> --project <PROJECT> --plan <PLAN_ID> --suite <SUITE_ID> --out test-cases.json
```

Esto trae el mapeo caso → Test Point, los pasos (Gherkin u otros) y la tabla de parámetros
(`@Cantidad`, `@Formato`…). Si no hay acceso, pide al usuario los pasos y parámetros tal cual
están en ADO y arma `test-cases.json` a mano con el mismo formato (ver
`references/ado-integration.md`).

Por qué: una automatización que verifica algo distinto a lo que dice el caso produce un
"Passed" falso, que es peor que no tener prueba. Los pasos y parámetros literales del caso
son el contrato.

### 2. Clasificar la variante y leer su referencia
- **API**: el caso habla de un endpoint, un request/response, un contrato JSON o Swagger.
  → Lee `references/api-swagger.md`.
- **UI**: el caso habla de una pantalla, botones, carga de archivos, mensajes al usuario.
  → Lee `references/ui-front.md`.

Si el caso mezcla ambas (p. ej. "al subir el archivo, el servicio registra…"), la evidencia
principal es la de la interfaz que el caso nombra; la otra puede usarse solo para preparar
datos o confirmar.

### 3. Explorar antes de automatizar
Antes de escribir aserciones, ejecuta el flujo real una vez (Playwright headed o el navegador
que tengas) y anota en `FLUJO-VALIDACION.md`:
- selectores reales, URLs y operación de Swagger (`#operations-<tag>-<operationId>`);
- textos exactos de mensajes/avisos y formato real de respuestas (incluidas las de error,
  que a veces cambian de convención, p. ej. `Succeeded` vs `succeeded`);
- límites (tamaños, cantidades), plantillas descargables, datos que el ambiente necesita.

Por qué: las aserciones escritas "a ciegas" fallan por diferencias de texto o formato que no
son defectos, y el equipo pierde confianza en la suite.

### 4. Preparar datos de prueba
Lee `references/test-data.md`. En resumen: prefiere reutilizar datos existentes (o crearlos
por API si el caso lo permite y el usuario está de acuerdo), reparte sin repetir entre tests,
usa fechas con desfase aleatorio y coordenadas con jitter para que corridas sucesivas no
choquen, y si faltan datos haz `test.skip(true, motivo)` en lugar de fallar o simular.

### 5. Generar el proyecto desde las plantillas
1. Copia `assets/templates/` al directorio de la suite: renombra `gitignore.txt` → `.gitignore`,
   `test-cases.example.json` → `test-cases.json` (o usa el descargado) y borra el
   `*.spec.template.js` de la variante que no uses.
2. Completa `env.example` con los **nombres** de las variables que el proyecto necesita
   (nunca valores reales). Crea `env` local para el ambiente `test` y `env.<nombre>` para otros.
3. Parte de `api.spec.template.js` o `ui.spec.template.js` y escribe un test por caso:
   - Título: `TC-<id>: <variante> - <resultado esperado>`. El `TC-<id>` en el título es lo que
     `qa-validate.py` usa para asociar el resultado; sin él el caso queda NotExecuted.
   - Casos con parámetros: un `for` sobre las filas de la tabla de ADO, con la variante en el
     título y en la evidencia.
   - Cada ejecución crea **una** evidencia con `startEvidence(tcId, variante)` y escribe todo
     (capturas, request, response, CSV, resultado) a través de ella. Así todos los archivos de
     una ejecución comparten timestamp y variante, y se agrupan sin ambigüedad.
   - Importa `test`/`expect` desde `./lib/fixtures.js` (no desde `@playwright/test`): su
     fixture automático aplica la política de evidencia visual al terminar cada test.
4. Configura la **evidencia visual** (ver la sección siguiente) en `env` y en `env.example`.
5. Completa `FLUJO-VALIDACION.md` desde `FLUJO-VALIDACION.template.md` con lo confirmado en
   la exploración.

#### Evidencia visual y datos sensibles: `EVIDENCE_CAPTURE`
Las capturas, el video y la traza pueden mostrar tokens, correos o datos personales, y el
video y la traza no se pueden enmascarar. Por eso la evidencia visual es una variable:

| `EVIDENCE_CAPTURE` | Capturas (.png) | Video | Cuándo usarlo |
|---|---|---|---|
| `on-failure` (por defecto) | solo de tests que fallan | solo si falla | caso general: lo visual aparece cuando hace falta diagnosticar |
| `always` | todas | todos | **cuando el usuario pide evidencia siempre** (auditoría, ADO con capturas de cada ejecución) |
| `off` | ninguna | ninguno | ambientes con datos reales de clientes o cuando nada visual puede salir del equipo |

- **Cuenta como pedirla** cualquier mención explícita de evidencia visual en el pedido:
  "evidencia siempre", "capturas de todo", "con evidencia desde Swagger", "quiero captura y
  video", "dejar activa la evidencia". En ese caso pon `EVIDENCE_CAPTURE=always` en `env`
  **y** en `env.example` (para que sea el valor del equipo) y dilo en FLUJO-VALIDACION.md.
  Quien pide capturas espera verlas también cuando la prueba pasa; dejar `on-failure` le
  entregaría una suite verde sin las capturas que pidió. No hace falta volver a preguntar en
  cada corrida: la decisión queda en la configuración.
- Si el pedido no menciona evidencia visual, deja `on-failure` y menciónalo en la entrega
  para que el usuario sepa que puede cambiarlo a `always`.
- Lo que se guarda **siempre**, en cualquier modo: los JSON (request, response, resultado) y
  los archivos de entrada, con las claves sensibles (`password`, `token`, `authorization`,
  `apiKey`…, más `EVIDENCE_REDACT_KEYS`) reemplazadas por `***`. Son la evidencia mínima de
  qué se hizo y qué respondió el sistema.
- Aun en `always`, las capturas de Swagger siguen enmascarando el bloque curl; añade a
  `opts.mask` cualquier otro elemento con datos sensibles que veas en la exploración.

### 6. Aserciones sobre lo observado
- Afirma exactamente lo que el caso espera: status HTTP, contadores
  (`enviados/exitosos/fallidos`), texto del mensaje con regex tolerante (`/máximo de 50/i`),
  presencia/ausencia de un aviso, estado de un botón.
- Pon un mensaje en el `expect` cuando el dato que explica el fallo no es obvio
  (`expect(x, \`Fallidos: ${errores}\`).toBe(0)`).
- Si un paso **no se puede automatizar** en ese ambiente (no hay forma de forzar un estado,
  de simular una caída…), usa `test.skip(true, '<motivo concreto>')` y documéntalo como límite.
  Termina como NotExecuted en ADO, que es honesto. Nunca simules un resultado.
- Reintentos: solo ante errores transitorios del ambiente que **no** son lo que se prueba
  (saldo no disponible, geocodificación intermitente, "error inesperado"), con un regex
  explícito y un máximo de intentos. Cada intento genera su propia evidencia.

### 7. Ejecutar y publicar
```bash
npm install && npx playwright install chromium
python qa-validate.py --dry-run          # ejecuta y resume, sin tocar ADO
python qa-validate.py                    # ambiente test: ejecuta y marca ADO
python qa-validate.py --env preproductivo [--ado]
python qa-validate.py --skip-playwright  # reutiliza la última corrida
python qa-validate.py --upload-only      # solo sube a ADO lo ya ejecutado
```
Regla de outcome (la implementa `qa-validate.py`; la fuente es el reporter JSON de
Playwright y cuenta solo el **último intento** de cada test):
- algún subtest `failed`/`timedOut`/`interrupted` → **Failed**, salvo que todos esos fallos
  sean de conectividad (DNS, conexión rechazada, timeout de red) → **Blocked**: no se llegó a
  probar el sistema, así que marcarlo Failed sería reportar un defecto que no existe
- todos `skipped` o sin datos → **NotExecuted**
- en otro caso → **Passed**

**Sin acceso al ambiente todavía:** deja el proyecto completo y verifica todo lo que puedas
sin red: `npx playwright test --list`, `qa-validate.py --dry-run` (los casos salen Blocked) y,
si vale la pena, un servidor simulado local (mock) que replique el contrato confirmado o
supuesto para comprobar que las aserciones detectan tanto el caso correcto como el defecto.
Marca como **supuesto** en FLUJO-VALIDACION.md todo lo que no se confirmó contra el ambiente.

Fuera del ambiente `test` no se marca ADO salvo `--ado`, para no pisar resultados de la suite.
Detalle de la API de ADO, comentario y adjuntos: `references/ado-integration.md`.

### 8. Exploratorias (si el usuario las pide o el caso lo amerita)
Casos borde fuera de los TC formales (encabezados en mayúsculas, separadores, valores límite,
campos ignorados en silencio…), con su propio script y reporte HTML de hallazgos.
Ver `references/exploratory-testing.md`.

### 9. Revisión de seguridad antes de compartir
```bash
python <skill>/scripts/scan_secrets.py <directorio-suite> [--deny <dominio-interno> ...]
```
Debe salir limpio antes de hacer commit, compartir un zip o publicar. Lee
`references/security.md`: las fugas típicas no están en `env` (que ya se ignora) sino en
valores "por defecto" en el código, en el `.md` de documentación, en `error-context.md` de
Playwright (incluye el JWT) y en capturas de Swagger.

## Convenciones de evidencia (resumen)
`<ts>-TC-<id>[-<variante>]-<tipo>.<ext>`, con `<ts>` = ISO sin milisegundos y `:`/`.`
cambiados por `-`. Tipos: `swagger-01-request.png`, `swagger-02-response.png`,
`request.json`, `response.json`, `input.csv`, `pantalla.png`, `resultado.json`.
Detalle y formato de cada JSON: `references/evidence-conventions.md`.

## Entrega
Al terminar, informa al usuario: casos automatizados y su outcome, casos saltados con su
motivo, hallazgos (si los hubo), cómo ejecutar, y el resultado del escaneo de seguridad.
Si algo no se pudo verificar en el ambiente real, dilo explícitamente.
