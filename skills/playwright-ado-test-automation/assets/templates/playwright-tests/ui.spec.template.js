// @ts-check
/**
 * Suite de validación UI — <NOMBRE DE LA SUITE>
 * Automatiza los casos reales de la Suite ADO <SUITE_ID> (Plan <PLAN_ID>) sobre la pantalla
 * real del front (no sobre la API): login, navegación, carga de archivo, lectura de avisos y
 * del panel de resultados.
 *
 * Evidencia por ejecución: input.csv (lo que se subió), pantalla.png, resultado.json; el video
 * lo genera Playwright (video: 'on') y qa-validate.py lo adjunta renombrado.
 *
 * Renombra este archivo a <suite>.spec.js. Selectores, textos y TC son EJEMPLOS: sustitúyelos
 * por lo confirmado en la exploración (FLUJO-VALIDACION.md) y por los pasos literales de ADO.
 */
// test/expect desde lib/fixtures.js: cierra la evidencia según EVIDENCE_CAPTURE.
import { test, expect } from './lib/fixtures.js';
import { cfg, optionalCfg, TEST_ENV } from './lib/config.js';
import { startEvidence } from './lib/evidence.js';
import { frontLogin, readDialogIfAny, parseCounters, withRetries } from './lib/ui.js';
import { toCsv, createPool, futureRange } from './lib/data.js';

const FRONT_LOGIN_URL = cfg('FRONT_LOGIN_URL');
const FRONT_SCREEN_URL = cfg('FRONT_SCREEN_URL');
console.log(`🌐 Ambiente: ${TEST_ENV} | Front: ${new URL(FRONT_LOGIN_URL).origin}`);

// Selectores confirmados en la exploración (ejemplos).
const SEL = {
  email: 'input[type="email"]',
  password: 'input[type="password"]',
  submit: 'button[type="submit"]',
  loggedIn: 'nav',
  openModal: 'button:has-text("Carga masiva")',
  modalTitle: 'text=Carga Masiva',
  fileInput: 'input[type="file"]',
  send: 'button:has-text("Procesar")',
  results: 'text=Resultados',
};

// Encabezados exactos de la plantilla real (descargarla en la exploración).
const HEADERS = ['id', 'fechaInicio', 'fechaFin', 'descripcion'];

// IDs existentes reutilizables (no se crean datos nuevos salvo que el caso lo pida).
const pool = createPool(optionalCfg('FIXTURE_IDS').split(',').filter(Boolean));

async function abrirPantalla(page) {
  await frontLogin(page, {
    url: FRONT_LOGIN_URL, email: cfg('FRONT_EMAIL'), password: cfg('FRONT_PASSWORD'),
    emailSel: SEL.email, passwordSel: SEL.password, submitSel: SEL.submit, loggedInSel: SEL.loggedIn,
  });
  await withRetries(async () => {
    await page.goto(FRONT_SCREEN_URL, { waitUntil: 'domcontentloaded' });
    await page.locator(SEL.openModal).click();
    await page.locator(SEL.modalTitle).waitFor({ timeout: 15000 });
  });
}

/**
 * Una ejecución: genera el CSV, lo guarda como evidencia, lo sube y lee el aviso o el panel.
 * Devuelve { aviso, resultado } y deja captura + resultado.json con el mismo prefijo.
 */
async function cargarYLeer(page, tcId, variante, rows, { enviar = true } = {}) {
  const ev = startEvidence(tcId, variante);
  const csvPath = ev.raw('input', 'csv', toCsv(HEADERS, rows, { sepLine: false }));
  await page.locator(SEL.fileInput).setInputFiles(csvPath);

  const aviso = await readDialogIfAny(page);
  let resultado = null;
  if (!aviso && enviar) {
    await page.locator(SEL.send).click();
    await page.locator(SEL.results).waitFor({ timeout: 60000 });
    const text = await page.locator('[role="dialog"], .modal.show').first().innerText();
    resultado = parseCounters(text, ['Enviados', 'Exitosos', 'Fallidos']);
  }
  const botonHabilitado = await page.locator(SEL.send).isEnabled().catch(() => null);
  await ev.screenshot(page, 'pantalla');
  ev.json('resultado', { variante, filas: rows.length, aviso, resultado, botonHabilitado });
  return { aviso, resultado, botonHabilitado };
}

test.describe('<NOMBRE DE LA SUITE> (UI) - Suite ADO <SUITE_ID>', () => {
  test.beforeEach(async ({ page }) => { await abrirPantalla(page); });

  // TC-<id> (Point <point>): <título literal del caso en ADO>
  test('TC-2001: Archivo válido - se procesan todos los registros', async ({ page }) => {
    const ids = pool.take(3);
    test.skip(!ids, `Faltan IDs reutilizables en FIXTURE_IDS (quedan ${pool.remaining}).`);
    const rows = ids.map((id, i) => ({ id, ...(({ start, end }) => ({ fechaInicio: start, fechaFin: end }))(futureRange()), descripcion: `QA-${i + 1}` }));

    const { aviso, resultado } = await cargarYLeer(page, 'TC-2001', '', rows);
    expect(aviso, `Apareció un aviso inesperado: ${JSON.stringify(aviso)}`).toBeNull();
    expect(resultado).toMatchObject({ enviados: 3, exitosos: 3, fallidos: 0 });
  });

  // Parámetros de ADO (@Cantidad) → un test por fila.
  for (const f of [{ n: 0, aviso: /no contiene registros/i }, { n: 51, aviso: /máximo/i }]) {
    test(`TC-2002: ${f.n} registros - aviso y botón deshabilitado`, async ({ page }) => {
      const rows = Array.from({ length: f.n }, (_, i) => ({ id: `0`, descripcion: `QA-${i}` }));
      const { aviso, botonHabilitado } = await cargarYLeer(page, 'TC-2002', `${f.n}registros`, rows, { enviar: false });
      expect(aviso?.text ?? '').toMatch(f.aviso);
      expect(botonHabilitado).toBe(false);
    });
  }

  test('TC-2003: Falla del servicio durante el procesamiento - mensaje de error', async () => {
    test.skip(true, 'No hay forma de inyectar una caída del servicio desde la IU en este ambiente; no se simula.');
  });
});
