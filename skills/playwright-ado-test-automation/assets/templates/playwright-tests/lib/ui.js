// @ts-check
/**
 * Helpers para la variante UI. Los selectores concretos de la aplicación se confirman en la
 * exploración y se documentan en FLUJO-VALIDACION.md; aquí solo están los patrones.
 */

/** Ejecuta una acción de navegación con reintentos ante flakiness de la SPA (no de negocio). */
export async function withRetries(fn, { attempts = 3 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { lastError = e; }
  }
  throw lastError;
}

/**
 * Login en el front. Ajusta los selectores a la pantalla real.
 * @param {import('@playwright/test').Page} page
 */
export async function frontLogin(page, { url, email, password, emailSel, passwordSel, submitSel, loggedInSel }) {
  await withRetries(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator(emailSel).fill(email);
    await page.locator(passwordSel).fill(password);
    await page.locator(submitSel).click();
    // Espera algo que SOLO existe autenticado; un sleep fijo esconde errores de login.
    await page.locator(loggedInSel).first().waitFor({ timeout: 45000 });
  });
}

/**
 * Lee un aviso modal si aparece y lo cierra. Por defecto SweetAlert2; pasa otros selectores
 * si la app usa otro componente. Devuelve null si no apareció (= no hubo validación).
 */
export async function readDialogIfAny(page, {
  titleSel = '.swal2-title', textSel = '.swal2-html-container', confirmSel = 'button.swal2-confirm', timeout = 3000,
} = {}) {
  const title = page.locator(titleSel);
  if (!(await title.isVisible({ timeout }).catch(() => false))) return null;
  const result = {
    title: ((await title.textContent()) || '').trim(),
    text: ((await page.locator(textSel).textContent().catch(() => '')) || '').trim(),
  };
  const confirm = page.locator(confirmSel);
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  return result;
}

/**
 * Extrae contadores tipo "Enviados: 3" de un texto de resultados.
 * @param {string} text
 * @param {string[]} labels
 */
export function parseCounters(text, labels) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const label of labels) {
    const m = text.match(new RegExp(`${label}\\s*:?\\s*(\\d+)`, 'i'));
    out[label.toLowerCase()] = m ? Number(m[1]) : NaN;
  }
  return out;
}
