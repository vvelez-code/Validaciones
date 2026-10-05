# FLUJO DE VALIDACIÓN FUNCIONAL — <Nombre de la suite> (<API | IU>)

> Documento maestro de la suite. Lo que aquí se afirma debe estar **confirmado contra el
> ambiente real** (exploración) o **copiado literal de ADO**. Nada de credenciales, tokens ni
> valores de `env`: solo nombres de variables.

## Contexto
- **Organización / Proyecto ADO:** `<ORG>` / `<PROJECT>`
- **Plan / Suite:** `<PLAN_ID>` / `<SUITE_ID>` — <nombre de la suite en ADO>
- **Qué se valida:** <endpoint `MÉTODO /ruta` | pantalla `<ruta del front>`> — <una frase de negocio>
- **Variante:** <API vía Swagger UI | IU real del front>
- **Fuente de los casos:** `GET .../testplan/Plans/<PLAN_ID>/Suites/<SUITE_ID>/TestPoint` y los
  campos `Microsoft.VSTS.TCM.Steps` / `LocalDataSource` de cada work item (`test-cases.json`).

## Autenticación
- <Cómo se obtiene el token / cómo se inicia sesión en el front>.
- Variables: `AUTH_LOGIN_URL`, `AUTH_EMAIL`, `AUTH_PASSWORD` | `FRONT_LOGIN_URL`, `FRONT_EMAIL`, `FRONT_PASSWORD`.
- <Particularidades: campo `source`, esquema de Swagger (apiKey "Bearer <token>" o http bearer), expiración…>

## Contrato / flujo real (confirmado en exploración)
<!-- API: request y response reales (con datos enmascarados), códigos, convención de errores.
     IU: pasos en pantalla, selectores, plantilla descargable. -->
| Paso | Acción | Selector / campo | Observado |
|---|---|---|---|
| 1 | <…> | `<selector>` | <…> |

### Validaciones y mensajes confirmados
| Situación | Respuesta / aviso exacto | Regex usada en la suite |
|---|---|---|
| <límite superado> | <"Se permite un máximo de 50…"> | `/máximo de 50/i` |

## Datos de prueba
- <Se reutilizan / se crean> — <de dónde salen, cómo se reparten, qué pasa si faltan (skip)>.
- Fechas con desfase aleatorio y coordenadas con jitter para no chocar entre corridas.
- Variables: `<FIXTURE_IDS>`, `<…>`.

## Test Cases (Suite <SUITE_ID> / Plan <PLAN_ID>)
| TC | Point | Caso (título ADO) | Qué verifica la suite | Estado |
|---|---|---|---|---|
| TC-<id> | <point> | <título> | <aserciones concretas> | Automatizado |
| TC-<id> | <point> | <título> | — | Skip: <motivo> |

### Parámetros (literales de ADO)
| TC | Parámetro | Valores |
|---|---|---|
| TC-<id> | `@Cantidad` | 49, 50, 51 |

## Límites conocidos
- **TC-<id>:** <qué no se puede automatizar y por qué>. Se marca `test.skip` → NotExecuted en ADO.

## Estructura del proyecto
```
playwright-tests/<suite>.spec.js   suite
playwright-tests/lib/               config, evidencia, swagger/ui, datos
qa-validate.py                      ejecución + outcome + ADO
test-cases.json                     TC → Point, pasos, parámetros
exploratory-tests/                  casos borde + reporte HTML
```

## Ejecución
```bash
npm install && npx playwright install chromium   # una vez
python qa-validate.py --dry-run                  # ejecutar sin tocar ADO
python qa-validate.py                            # ambiente test + marcar ADO
python qa-validate.py --env <nombre> [--ado]     # otro ambiente (env.<nombre>)
python qa-validate.py --skip-playwright          # reutilizar última corrida
python qa-validate.py --upload-only              # solo subir a ADO
```

### Cómo se determina el outcome
Fuente: `test-results[-<env>]/playwright-results.json`, último intento de cada test.
Algún `failed`/`timedOut`/`interrupted` → **Failed** (o **Blocked** si todos fueron de conectividad) · todos `skipped` → **NotExecuted** · resto → **Passed**.

### Evidencia visual (`EVIDENCE_CAPTURE`)
Valor del equipo: `<on-failure | always | off>` — <por qué: p. ej. "always: QA pide capturas de
cada ejecución en ADO">. Los JSON se guardan siempre con claves sensibles en `***`.

### Evidencia por ejecución
`evidence-validacion/[<env>/]<ts>-TC-<id>[-<variante>]-<tipo>.<ext>`
- API: `swagger-01-request.png`, `swagger-02-response.png`, `request.json`, `response.json`
- IU: `input.csv`, `pantalla.png`, `resultado.json` + video `TC-<id>-<slug>.webm` en ADO

### Inestabilidad del ambiente
<Errores transitorios conocidos que se reintentan (regex) y por qué no son lo que se prueba.>

## Notas de seguridad
- `env` / `env.*` no se versionan; `env.example` solo lleva marcadores.
- Las capturas de Swagger enmascaran el bloque curl (token); la evidencia visual sigue `EVIDENCE_CAPTURE`.
- Antes de compartir: `python <skill>/scripts/scan_secrets.py . --deny <dominio-interno>`.
