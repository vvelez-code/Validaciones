# playwright-ado-test-automation

Skill para agentes de IA (Claude Code, Cursor, Codex, OpenCode…) que **automatiza casos de
prueba de Azure DevOps con Playwright** y deja un proyecto de validación completo:

- **Suite Playwright por ambiente**: `env` / `env.<nombre>`, sin credenciales en el código.
- **Evidencia emparejada por ejecución**:
  - **API**: capturas de Swagger UI del request y del response (con el token enmascarado) y `request.json` / `response.json`.
  - **UI**: el archivo subido, una captura de la pantalla, `resultado.json` y video.
- **Evidencia visual configurable** con `EVIDENCE_CAPTURE` (`on-failure` por defecto, `always` si el equipo pide evidencia de cada ejecución, `off`). Los JSON de evidencia se guardan siempre, con contraseñas y tokens reemplazados por `***`.
- **`qa-validate.py`**: ejecuta la suite y decide **Passed / Failed / Blocked / NotExecuted**. Un fallo de conectividad queda Blocked y no Failed. Luego marca los Test Points de ADO, con un comentario y la evidencia adjunta. Con `--dry-run` hace todo sin ADO.
- **`FLUJO-VALIDACION.md`**: documento maestro de la suite (contrato, mensajes reales, casos, límites, ejecución).
- **Pruebas exploratorias** con reporte HTML de hallazgos.
- **Escáner de secretos** para usar antes de compartir o publicar.

Cubre dos variantes:

| Variante | Qué se valida | Evidencia |
|---|---|---|
| **API** | Endpoint ejecutado desde Swagger UI (Authorize → Try it out → Execute) | `swagger-01-request.png`, `swagger-02-response.png`, `request.json`, `response.json` |
| **UI** | Pantalla real del front (login, carga de archivos, avisos, panel de resultados) | `input.csv`, `pantalla.png`, `resultado.json`, video `.webm` |

## Instalación

```bash
npx skills add <tu-usuario>/playwright-ado-test-automation
```

O copia `skills/playwright-ado-test-automation/` a `~/.claude/skills/` (u otra carpeta de
skills de tu agente).

## Uso

La skill se activa de dos formas:

- **Directa**: `/playwright-ado-test-automation`, o "usa la skill playwright-ado-test-automation".
- **Automática**: cuando pides algo como *"automatiza el TC-1234 de la suite 5678"*, *"valida
  este endpoint desde Swagger con evidencia"* o *"marca los test points en Azure DevOps"*.

Flujo que sigue el agente:

1. Obtiene los casos reales de ADO (`scripts/ado_fetch_cases.py`) o los toma de lo que pegues.
2. Clasifica cada caso como API o UI.
3. Explora el ambiente antes de escribir aserciones.
4. Genera el proyecto desde `assets/templates/`.
5. Escribe un test por caso, o uno por parámetro, y salta con motivo lo que no se puede automatizar.
6. Ejecuta con `qa-validate.py --dry-run` y, si se lo pides, marca ADO.
7. Pasa `scripts/scan_secrets.py`.

## Requisitos

- Node 18+ y `@playwright/test`.
- Python 3.9+ y `requests`, solo para marcar ADO o descargar casos.
- Un PAT de Azure DevOps con *Test Management (Read & Write)* y *Work Items (Read)*. Solo hace falta para integrar con ADO.

## Estructura

```
skills/playwright-ado-test-automation/
├── SKILL.md                 # flujo principal
├── references/              # guías por tema (API/Swagger, UI, ADO, evidencia, datos, exploratorias, seguridad)
├── assets/templates/        # proyecto base: config, libs, specs de ejemplo, qa-validate.py, plantillas
└── scripts/                 # ado_fetch_cases.py, scan_secrets.py
evals/evals.json             # prompts de evaluación de la skill
```

## Publicar tu fork

```bash
git remote add origin https://github.com/<tu-usuario>/playwright-ado-test-automation.git
git push -u origin main
```

El repo debe ser **público** para aparecer en [skills.sh](https://skills.sh). Antes de cada push:

```bash
python skills/playwright-ado-test-automation/scripts/scan_secrets.py . --deny <tu-dominio-interno>
```

## Licencia

MIT
