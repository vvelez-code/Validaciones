// @ts-check
import { defineConfig, devices } from '@playwright/test';
// Carga env / env.<ambiente> y resuelve EVIDENCE_CAPTURE (always | on-failure | off).
import { TEST_ENV } from './playwright-tests/lib/config.js';
import { EVIDENCE_CAPTURE } from './playwright-tests/lib/evidence.js';

// Los reportes de un ambiente distinto de test van a carpetas con sufijo para no mezclarse.
const ENV_SUFFIX = TEST_ENV === 'test' ? '' : `-${TEST_ENV}`;

// Evidencia visual automática de Playwright según EVIDENCE_CAPTURE. El video y la traza NO se
// pueden enmascarar (muestran todo lo que pasa en pantalla y, la traza, los requests con el
// token), por eso solo se conservan siempre si el usuario lo pidió (EVIDENCE_CAPTURE=always).
// PW_VIDEO=off apaga el video aunque el modo sea "always" (p. ej. variante API, donde el
// video no aporta sobre las capturas de Swagger).
const VISUAL = {
  always: { video: 'on', screenshot: 'on', trace: 'retain-on-failure' },
  'on-failure': { video: 'retain-on-failure', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  off: { video: 'off', screenshot: 'off', trace: 'off' },
}[EVIDENCE_CAPTURE];
const video = /** @type {any} */ (process.env.PW_VIDEO || VISUAL.video);

export default defineConfig({
  testDir: './playwright-tests',
  // Un worker y sin paralelismo: los casos comparten datos reales del ambiente y la evidencia
  // debe quedar en orden.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Variante UI: PW_RETRIES=2 ante flakiness del ambiente (qa-validate.py solo cuenta el último
  // intento). Variante API: 0 suele bastar; los transitorios se reintentan en el propio test.
  retries: Number(process.env.PW_RETRIES ?? 0),
  reporter: [
    ['html', { outputFolder: `playwright-report${ENV_SUFFIX}`, open: 'never' }],
    ['list'],
    // Fuente de verdad del pass/fail para qa-validate.py.
    ['json', { outputFile: `test-results${ENV_SUFFIX}/playwright-results.json` }],
  ],
  outputDir: `test-results${ENV_SUFFIX}`,
  use: {
    trace: /** @type {any} */ (VISUAL.trace),
    screenshot: /** @type {any} */ (VISUAL.screenshot),
    video,
    actionTimeout: 45000,
    navigationTimeout: 45000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  timeout: 180 * 1000,
  expect: { timeout: 10000 },
});
