// @ts-check
/**
 * Ejecución real de una operación desde Swagger UI (Authorize → Try it out → Execute) con
 * capturas del request y del response. Es la MISMA llamada que se valida: no hay una segunda
 * llamada "por detrás", así la captura y el JSON muestran exactamente lo que se probó.
 *
 * Selectores de Swagger UI 3.x/4.x/5.x. Si el Swagger del proyecto es otro (Redoc, Scalar…),
 * ajústalos en la fase de exploración y documenta el cambio en FLUJO-VALIDACION.md.
 */

/** Bloques que pueden mostrar el token (curl generado, request url con query de auth). */
export const swaggerMask = (page) => [
  page.locator('.curl-command'),
  page.locator('.curl'),
  page.locator('.auth-container input'),
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} p
 * @param {string} p.swaggerUrl   p.ej. https://api.example.com/swagger/index.html
 * @param {string} p.operationId  id del bloque: '#operations-<Tag>-<operationId>'
 * @param {object|null} p.body    cuerpo JSON (null si la operación no lleva body)
 * @param {Record<string,string>} [p.params]  parámetros de path/query por nombre
 * @param {string} [p.token]      token sin 'Bearer '
 * @param {string} [p.authScheme] 'Bearer' (apiKey con prefijo) | 'bearer-http' (esquema http bearer)
 * @param {ReturnType<import('./evidence.js').startEvidence>} p.evidence
 * @param {number} [p.timeoutMs]
 * @param {string[]} [p.removeOverlays]  selectores de banners/overlays (cookies, chat) que tapan Swagger
 */
export async function executeInSwagger(page, { swaggerUrl, operationId, body, params = {}, token, authScheme = 'Bearer', evidence, timeoutMs = 45000, removeOverlays = [] }) {
  await page.goto(swaggerUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.swagger-ui .information-container', { timeout: 30000 });
  if (removeOverlays.length) {
    // Un banner encima intercepta los clicks y además ensucia la captura.
    await page.addStyleTag({ content: `${removeOverlays.join(',')} { display: none !important; }` });
  }

  const op = page.locator(operationId);
  await op.waitFor({ timeout: 30000 });
  if (!(await op.locator('.opblock-body').isVisible().catch(() => false))) {
    await op.locator('.opblock-summary').first().click();
  }

  if (token) {
    const authorize = page.locator('button.btn.authorize').first();
    if (await authorize.isVisible().catch(() => false)) {
      await authorize.click();
      // apiKey en header espera "Bearer <token>"; el esquema http bearer espera solo el token.
      const value = authScheme === 'bearer-http' ? token : `Bearer ${token}`;
      // apiKey suele tener #api_key_value; si no, el primer input de texto del modal.
      await page.locator('#api_key_value, .auth-container input[type="text"]').first().fill(value);
      await page.locator('.auth-btn-wrapper button.authorize').first().click();
      await page.locator('.auth-btn-wrapper button.btn-done').first().click();
    }
  }

  await op.locator('button.try-out__btn').click();

  for (const [name, value] of Object.entries(params)) {
    await op.locator(`tr[data-param-name="${name}"] input`).fill(String(value));
  }
  if (body !== null && body !== undefined) {
    const textarea = op.locator('textarea.body-param__text');
    await textarea.fill(JSON.stringify(body, null, 2));
  }

  await op.scrollIntoViewIfNeeded();
  await evidence.screenshot(page, 'swagger-01-request');

  const start = Date.now();
  await op.locator('button.execute').click();
  await op.locator('.live-responses-table .response-col_status').first().waitFor({ timeout: timeoutMs });
  const duration = Date.now() - start;

  await op.locator('h4', { hasText: 'Server response' }).scrollIntoViewIfNeeded().catch(() => {});
  await evidence.screenshot(page, 'swagger-02-response');

  const statusText = await op.locator('.live-responses-table tr.response td.response-col_status').first().textContent();
  const status = statusText ? parseInt(statusText.trim(), 10) : null;
  const bodyText = await op.locator('.live-responses-table .response-col_description pre').first().textContent().catch(() => null);
  let responseBody = bodyText;
  try { responseBody = bodyText ? JSON.parse(bodyText) : null; } catch { /* no es JSON: se guarda texto */ }
  // URL que Swagger llamó de verdad: permite comprobar que se probó el host del ambiente.
  const requestUrl = ((await op.locator('.request-url pre').first().textContent().catch(() => '')) || '').trim() || null;

  return { status, body: responseBody, duration, requestUrl };
}
