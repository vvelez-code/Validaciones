# Integración con Azure DevOps

## Obtener los casos (`scripts/ado_fetch_cases.py`)
| Dato | API |
|---|---|
| Test Points de la suite (caso → point) | `GET {org}/{project}/_apis/testplan/Plans/{plan}/Suites/{suite}/TestPoint?api-version=7.0` (paginado con `x-ms-continuationtoken`) |
| Título, pasos, parámetros | `GET {org}/{project}/_apis/wit/workitems?ids=...&fields=System.Title,Microsoft.VSTS.TCM.Steps,Microsoft.VSTS.TCM.LocalDataSource,Microsoft.VSTS.TCM.Parameters&api-version=7.1` |

- `Microsoft.VSTS.TCM.Steps` es XML con `<step><parameterizedString>acción</…><parameterizedString>esperado</…></step>`;
  el texto viene como HTML escapado. Los pasos compartidos aparecen como `<compref ref="id">`.
- `Microsoft.VSTS.TCM.LocalDataSource` es XML `NewDataSet/Table1` con una fila por iteración
  (`<Cantidad>51</Cantidad>`): esas filas son el `for` del test parametrizado.
- Autenticación: Basic con `":" + PAT` en base64. Permisos del PAT: *Test Management (Read &
  Write)* y *Work Items (Read)*.

### Formato de `test-cases.json`
```json
{
  "organization": "<ORG>", "project": "<PROJECT>", "plan_id": 1000, "suite_id": 2000,
  "suite_name": "mi-suite",
  "cases": {
    "1001": { "point_id": 5001, "name": "<título>", "steps": [{"action": "...", "expected": "..."}], "parameters": [{"Cantidad": "51"}] }
  }
}
```
Sin acceso a ADO, arma este archivo a mano con lo que el usuario pegue (`point_id` puede
quedar en `null` hasta tenerlo; `qa-validate.py --dry-run` funciona igual).

## Marcar resultados (`qa-validate.py`)
1. `PATCH .../testplan/Plans/{plan}/Suites/{suite}/TestPoint?api-version=7.0-preview.2`
   con `[{ "id": point_id, "results": { "outcome": "passed|failed|blocked|notExecuted", "state": "completed" } }]`.
   `blocked` se usa cuando todos los fallos fueron de conectividad con el ambiente.
   Esto crea un run/result nuevo para el point.
2. `GET` del mismo endpoint para leer `results.lastTestRunId` / `results.lastResultId`.
3. `PATCH .../test/runs/{runId}/results?api-version=7.1` con `[{ "id": resultId, "comment": ... }]`.
4. `POST .../test/runs/{runId}/results/{resultId}/attachments?api-version=7.1-preview.1`
   con `{ stream: <base64>, fileName, attachmentType: "GeneralAttachment" }` por cada archivo.

### Comentario (máx. ~3500 caracteres; ADO trunca)
```
TC-<id> | <título> | <Outcome>
Ambiente: <env>
Fecha: <AAAA-MM-DD HH:MM>
Evidencia adjunta: N archivo(s) | captura visual: on-failure

✅ <título del test> (3.2s)
⏭️ <título> 
    Motivo (no ejecutado): <motivo del skip>
❌ <título> [intento 3/3]
    Error: <primera línea del error>

<ts>-TC-<id>-<variante> | Se hizo: request con 51 ítem(s) | Se obtuvo: HTTP 400 en 812 ms | "Se permite un máximo de 50…" | 2 captura(s)
```

## Ambientes y ADO
- Solo el ambiente `test` marca ADO por defecto. Para otro ambiente hace falta `--ado`, porque
  la suite de ADO es una sola y un resultado de preproductivo pisaría el de test.
- El PAT es independiente del ambiente: si `env.<nombre>` no lo trae, se toma de `env`.
- `--dry-run` nunca contacta ADO: úsalo siempre la primera vez y cuando no haya PAT.

## Errores frecuentes
| Síntoma | Causa |
|---|---|
| 401/203 con HTML de login | PAT vencido o sin permisos; o se mandó como Bearer en vez de Basic |
| 404 en TestPoint | plan/suite equivocados o proyecto con espacios sin codificar |
| Point marcado pero sin adjuntos | `lastResultId` aún no disponible: reintentar el GET tras 1-2 s |
| TC siempre NotExecuted | el título del test no contiene `TC-<id>` o falta el reporter `json` |
