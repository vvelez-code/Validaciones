# Seguridad e higiene de la información

Un proyecto de validación toca credenciales, tokens y datos reales. Las fugas casi nunca
vienen del archivo `env` (que ya se ignora) sino de lugares "inocentes".

## Reglas
1. **Credenciales solo en `env` / `env.<nombre>`**, que están en `.gitignore`. `env.example`
   lleva marcadores `<...>`. Nada de `TEST_DEFAULTS = { password: '...' }` en el código: si
   falta una variable, `cfg()` falla con un mensaje claro. Un valor por defecto "para que
   funcione en test" termina publicado con el repo.
2. **La documentación no lleva credenciales.** FLUJO-VALIDACION.md nombra variables, nunca
   sus valores; tampoco usuarios de prueba "porque son de test".
3. **Evidencia visual bajo control (`EVIDENCE_CAPTURE`)**: capturas, video y traza pueden
   mostrar datos sensibles; video y traza no se pueden enmascarar. Por defecto (`on-failure`)
   solo se conservan cuando un test falla; `always` solo si el usuario lo pide; `off` en
   ambientes con datos reales de clientes. Las capturas de Swagger enmascaran siempre el bloque
   curl (`swaggerMask`); si ves otro elemento sensible (correo, documento, saldo), agrégalo a
   `opts.mask`.
4. **JSON de evidencia censurados**: `ev.json()` reemplaza por `***` los valores de
   `password`, `token`, `authorization`, `apiKey`, `secret`… y cualquier JWT dentro de textos.
   Si el dominio tiene otros campos sensibles (número de documento, tarjeta), añádelos en
   `EVIDENCE_REDACT_KEYS`.
5. **Artefactos de Playwright**: `test-results*/**/error-context.md`, `trace.zip` y el reporte
   HTML pueden incluir requests completos con el token. Están en `.gitignore`; no se adjuntan a
   ADO ni se comparten fuera.
6. **Evidencia** (`evidence-validacion/`) contiene IDs y datos reales: va a ADO (que tiene
   control de acceso), no al repositorio.
7. **Nombres internos**: si el proyecto se va a publicar, generaliza dominios, nombres de
   empresa, organización/proyecto de ADO e IDs de plan/suite.
8. **No imprimas secretos** en `console.log` (ni el token, ni el body del login).

## Checklist antes de commit / compartir / publicar
```bash
python <skill>/scripts/scan_secrets.py . --deny <dominio-interno> --deny <empresa>
git status --ignored   # env*, evidence-validacion/, test-results*/, playwright-report*/ deben aparecer como ignorados
```
- [ ] `scan_secrets.py` sin hallazgos
- [ ] Ningún `env` distinto de `env.example` versionado
- [ ] Capturas revisadas a ojo si van a salir de ADO
- [ ] Si un secreto llegó a un commit: **rótalo** (cambiar contraseña / revocar PAT). Borrarlo
      del último commit no basta; queda en el historial.
