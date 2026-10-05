# Variante API — ejecución desde Swagger UI

Úsala cuando el caso valida un endpoint (contrato, status, mensajes de error, lotes).

## Por qué desde Swagger y no solo con `request`
La evidencia que el equipo de QA y negocio sabe leer es la pantalla de Swagger con el request
armado y el response real. Por eso la llamada **bajo prueba** se ejecuta en Swagger UI
(`executeInSwagger` en `lib/swagger.js`) y de esa misma ejecución salen las capturas y los
JSON. No hagas una llamada por `request` "para validar" y otra en Swagger "para la foto":
podrían dar resultados distintos y la evidencia dejaría de representar lo probado.

El fixture `request` de Playwright sí se usa para todo lo que **no** es lo que se prueba:
login, creación o consulta de datos de prueba, verificación posterior (GET por id).

## Pasos
1. **Encontrar la operación.** Abre `SWAGGER_URL` y localiza el bloque. Su id es
   `#operations-<Tag>-<operationId>`, p. ej. `#operations-Orders-put_api_v1_Orders_BulkUpdate`.
   Confírmalo en el DOM (los espacios del tag se convierten en `_`).
2. **Esquema de autorización.** Abre "Authorize":
   - `apiKey` en header → el valor es `Bearer <token>` (`authScheme: 'Bearer'`, por defecto).
   - `http` bearer → el valor es solo el token (`authScheme: 'bearer-http'`).
3. **Body y parámetros.** `body` va al `textarea.body-param__text`; path/query van por
   `params: { nombre: valor }` (`tr[data-param-name="nombre"] input`).
4. **Capturas.** `swagger-01-request.png` antes de Execute y `swagger-02-response.png` con el
   "Server response" visible. Son de página completa y **enmascaran el bloque curl**
   (`swaggerMask`), que contiene el token en claro.
   Si un banner (cookies, chat, aviso legal) tapa Swagger, pásalo en
   `removeOverlays: ['<selector>']`: intercepta los clicks y además ensucia la captura.
5. **Lectura del resultado.** Status de `.response-col_status`, cuerpo de `pre` (se parsea a
   JSON si se puede). Duración = tiempo entre Execute y la aparición del status.
6. **JSON de evidencia.** `request.json` = el body enviado; `response.json` =
   `{ status, duration, body, requestUrl }`. Ambos pasan por `redact()` (claves sensibles en
   `***`). Aserta `requestUrl` contra `API_BASE_URL` si hay varios servidores en el selector
   de Swagger: confirma que la evidencia corresponde al ambiente bajo prueba.
7. **Video.** En la variante API casi nunca aporta sobre las capturas; con
   `EVIDENCE_CAPTURE=always` puedes apagarlo con `PW_VIDEO=off`.

## Aserciones típicas
```js
expect(status).toBe(200);
expect(res.data.totalEnviados).toBe(items.length);
expect(res.data.totalFallidos, `Errores: ${JSON.stringify(res.data.fallidos)}`).toBe(1);
expect(res.data.fallidos[0].errores.join(' ')).toMatch(/rango/i);
```
- Respuestas de error de validación de frameworks (.NET FluentValidation, etc.) a veces
  cambian la convención (`Succeeded/Errors` vs `succeeded/errors`). Aserta sobre
  `JSON.stringify(res)` con regex, o normaliza claves, en vez de suponer una forma.
- Lotes con éxitos y fallos parciales: verifica que el ítem malo falla **y** que el bueno
  sale exitoso; es lo que garantiza que un error no contamina al resto.

## Datos y reintentos
- Si el endpoint necesita entidades existentes (un `id` real), créalas o búscalas en
  `beforeAll` con `request` (ver `test-data.md`) y no guardes evidencia de esa preparación
  salvo que el caso la pida.
- Errores transitorios del ambiente (saldo, geocodificación, 5xx esporádicos) → `retryTransient`
  con regex explícita. Cada intento crea su propia evidencia, así ADO muestra también los
  intentos fallidos y nadie se pregunta por qué hay más capturas que JSON.

## Si no hay Swagger
Si la API no expone Swagger UI (o el caso dice explícitamente "por Postman/cURL"), ejecuta con
`request` y guarda `request.json` + `response.json` sin capturas; explícalo en
FLUJO-VALIDACION.md. Si existe otra UI de documentación (Redoc, Scalar), adapta los
selectores de `lib/swagger.js` y documenta el cambio.
