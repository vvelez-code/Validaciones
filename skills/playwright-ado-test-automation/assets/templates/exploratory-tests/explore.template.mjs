// Pruebas exploratorias — casos borde fuera de los TC formales.
//
// No usa el test runner: cada escenario se ejecuta, se observa y se REGISTRA (esperado vs
// observado + hallazgo), sin aserciones que corten la corrida. Al final genera
// resultados-exploratorio.json y el reporte HTML a partir de reporte-exploratorio.template.html.
//
//   node exploratory-tests/explore.mjs              (ambiente test)
//   TEST_ENV=preproductivo node exploratory-tests/explore.mjs
//
// Renombra a explore.mjs y reemplaza los escenarios de ejemplo.
import { chromium, request as pwRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cfg, optionalCfg, TEST_ENV, IS_DEFAULT_ENV } from '../playwright-tests/lib/config.js';
import { ts, slug } from '../playwright-tests/lib/evidence.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, IS_DEFAULT_ENV ? 'evidence' : `evidence-${TEST_ENV}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

/** @type {any[]} */
const resultados = [];

/**
 * Registra un escenario.
 * veredicto: 'correcto' | 'bug' | 'observacion' | 'informativo'
 * severidad (si es bug/observación): 'alta' | 'media' | 'baja'
 */
function registrar({ escenario, descripcion, esperado, observado, veredicto, severidad = '', hallazgo = '', evidencias = [] }) {
  resultados.push({ escenario, descripcion, esperado, observado, veredicto, severidad, hallazgo, evidencias });
  const icon = { correcto: '✅', bug: '🐞', observacion: '⚠️', informativo: 'ℹ️' }[veredicto] || '•';
  console.log(`${icon} ${escenario}: ${observado}`);
}

/** Guarda un archivo de entrada (CSV, JSON) y devuelve su ruta relativa al reporte. */
function guardar(escenario, ext, content) {
  const f = path.join(OUT_DIR, `${ts()}-${slug(escenario)}.${ext}`);
  fs.writeFileSync(f, content);
  return path.relative(HERE, f).replace(/\\/g, '/');
}

async function captura(page, escenario) {
  const f = path.join(OUT_DIR, `${ts()}-${slug(escenario)}.png`);
  await page.screenshot({ path: f, fullPage: true });
  return path.relative(HERE, f).replace(/\\/g, '/');
}

async function main() {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const page = await browser.newPage();
  const api = await pwRequest.newContext();

  // ── Escenario de ejemplo (API): campo con mayúsculas en el nombre ──────────────────────────
  {
    const escenario = 'encabezados-en-mayusculas';
    const body = { ITEMS: [{ ID: 'X' }] };
    const input = guardar(escenario, 'json', JSON.stringify(body, null, 2));
    const res = await api.post(`${cfg('API_BASE_URL')}/<endpoint>`, { data: body, failOnStatusCode: false });
    const text = await res.text();
    registrar({
      escenario,
      descripcion: 'Mismo payload válido con los nombres de campo en mayúsculas.',
      esperado: 'Se acepta (JSON case-insensitive) o se rechaza con un mensaje que nombre el campo.',
      observado: `HTTP ${res.status()} — ${text.slice(0, 160)}`,
      veredicto: res.status() < 500 ? 'informativo' : 'bug',
      severidad: res.status() < 500 ? '' : 'media',
      hallazgo: res.status() < 500 ? '' : 'Error 5xx ante un payload mal formado: debería ser 400 con mensaje claro.',
      evidencias: [input],
    });
  }

  // ── Escenario de ejemplo (UI) ──────────────────────────────────────────────────────────────
  if (optionalCfg('FRONT_SCREEN_URL')) {
    const escenario = 'coma-dentro-de-campo';
    await page.goto(cfg('FRONT_SCREEN_URL'));
    const img = await captura(page, escenario);
    registrar({
      escenario,
      descripcion: 'Descripción con una coma entre comillas en el CSV.',
      esperado: 'La fila se procesa con la descripción completa.',
      observado: '<completar con lo observado>',
      veredicto: 'informativo',
      evidencias: [img],
    });
  }

  await browser.close();
  await api.dispose();

  const resumen = {
    titulo: 'Pruebas exploratorias — <NOMBRE DE LA SUITE>',
    ambiente: TEST_ENV,
    fecha: new Date().toISOString(),
    totales: resultados.reduce((acc, r) => ({ ...acc, [r.veredicto]: (acc[r.veredicto] || 0) + 1 }), {}),
    resultados,
  };
  const jsonFile = path.join(OUT_DIR, 'resultados-exploratorio.json');
  fs.writeFileSync(jsonFile, JSON.stringify(resumen, null, 2));

  const template = fs.readFileSync(path.join(HERE, 'reporte-exploratorio.template.html'), 'utf-8');
  const html = template.replace('/*__DATA__*/null', JSON.stringify(resumen).replace(/</g, '\\u003c'));
  const reportFile = path.join(HERE, `reporte-exploratorio${IS_DEFAULT_ENV ? '' : `-${TEST_ENV}`}.html`);
  fs.writeFileSync(reportFile, html);
  console.log(`\n📄 ${path.relative(process.cwd(), jsonFile)}\n📊 ${path.relative(process.cwd(), reportFile)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
