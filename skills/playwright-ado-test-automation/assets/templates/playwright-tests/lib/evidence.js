// @ts-check
/**
 * Evidencia de cada ejecución.
 *
 * Todo lo que produce UNA ejecución (capturas, request, response, CSV, resultado) se escribe a
 * través del mismo objeto devuelto por startEvidence(), así comparte timestamp y variante:
 *
 *   <ts>-TC-<id>[-<variante>]-<tipo>.<ext>
 *   2026-01-15T10-20-30-TC-1001-limite-51-swagger-01-request.png
 *   2026-01-15T10-20-30-TC-1001-limite-51-request.json
 *   2026-01-15T10-20-30-TC-1001-limite-51-response.json
 *
 * qa-validate.py agrupa por el prefijo anterior a <tipo>, de modo que una captura nunca queda
 * separada de su JSON (si cada archivo llevara su propio timestamp o una variante escrita
 * distinto, el agrupamiento se rompe).
 *
 * Datos sensibles — dos controles, ambos por variable de entorno:
 *
 *   EVIDENCE_CAPTURE = always | on-failure | off     (por defecto: on-failure)
 *     Gobierna la evidencia VISUAL (capturas .png, y en playwright.config.js el video y la traza),
 *     que es la que puede mostrar tokens, correos o datos personales que no siempre se pueden
 *     enmascarar. Con "on-failure" las capturas se toman igual (no se sabe el resultado antes) y
 *     se borran al terminar si el test pasó. "always" es para cuando el usuario pide evidencia
 *     visual de TODAS las ejecuciones (p. ej. para auditoría en ADO).
 *     Los JSON y archivos de entrada se guardan siempre: son la evidencia mínima de qué se hizo.
 *
 *   EVIDENCE_REDACT_KEYS = lista separada por comas (se suma a la lista por defecto)
 *     Claves cuyo valor se reemplaza por "***" en los JSON de evidencia.
 */
import fs from 'fs';
import path from 'path';
import { TEST_ENV, IS_DEFAULT_ENV, optionalCfg } from './config.js';

export const EVIDENCE_DIR = path.join(process.cwd(), 'evidence-validacion', ...(IS_DEFAULT_ENV ? [] : [TEST_ENV]));
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const MODES = ['always', 'on-failure', 'off'];
export const EVIDENCE_CAPTURE = (() => {
  const m = optionalCfg('EVIDENCE_CAPTURE', 'on-failure').trim().toLowerCase();
  if (!MODES.includes(m)) throw new Error(`EVIDENCE_CAPTURE="${m}" no es válido (${MODES.join(' | ')}).`);
  return m;
})();

const DEFAULT_REDACT = ['password', 'pwd', 'contrasena', 'contraseña', 'token', 'access_token',
  'accessToken', 'refresh_token', 'refreshToken', 'authorization', 'apiKey', 'api_key', 'secret', 'clientSecret'];
const REDACT = new Set([...DEFAULT_REDACT, ...optionalCfg('EVIDENCE_REDACT_KEYS').split(',')]
  .map((k) => k.trim().toLowerCase()).filter(Boolean));

/** Copia profunda con los valores de claves sensibles reemplazados por "***". */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) =>
      [k, REDACT.has(k.toLowerCase()) && typeof v === 'string' && v !== '' ? '***' : redact(v)]));
  }
  // JWT sueltos dentro de textos (mensajes de error, headers serializados).
  return typeof value === 'string' ? value.replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '***') : value;
}

export function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

/** Variante apta para nombre de archivo: sin espacios ni acentos, estable entre corridas. */
export function slug(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9.+-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Capturas tomadas en el test en curso; finalizeEvidence decide si se conservan. */
let visualFiles = [];

/**
 * Inicia la evidencia de una ejecución.
 * @param {string} tcId  'TC-1001' o '1001'
 * @param {string} [variante]  parámetro o escenario ('51', 'formato-pdf', 'sin-iniciar'...)
 * @param {{ mask?: (page: import('@playwright/test').Page) => import('@playwright/test').Locator[] }} [opts]
 */
export function startEvidence(tcId, variante = '', opts = {}) {
  const id = String(tcId).replace(/^TC-/i, '');
  const base = `${ts()}-TC-${id}${variante ? `-${slug(variante)}` : ''}`;
  const files = [];
  const file = (tipo, ext) => path.join(EVIDENCE_DIR, `${base}-${tipo}.${ext}`);
  const log = (icon, f) => { files.push(f); console.log(`    ${icon} ${path.relative(process.cwd(), f)}`); };

  return {
    base,
    files,
    /** Guarda un JSON (request, response, resultado...) con las claves sensibles censuradas. */
    json(tipo, data) {
      const f = file(tipo, 'json');
      fs.writeFileSync(f, JSON.stringify(redact(data), null, 2));
      log('📁', f);
      return f;
    },
    /** Guarda un archivo de texto/binario tal cual se usó (CSV subido, plantilla descargada...). */
    raw(tipo, ext, content) {
      const f = file(tipo, ext);
      fs.writeFileSync(f, content);
      log('📄', f);
      return f;
    },
    /**
     * Captura de página completa, enmascarando lo que devuelva opts.mask (tokens, datos
     * personales). Respeta EVIDENCE_CAPTURE: con "off" no captura nada.
     */
    async screenshot(page, tipo) {
      if (EVIDENCE_CAPTURE === 'off') return null;
      const f = file(tipo, 'png');
      const mask = opts.mask ? opts.mask(page) : [];
      await page.screenshot({ path: f, fullPage: true, mask, maskColor: '#222' });
      visualFiles.push(f);
      log('📸', f);
      return f;
    },
  };
}

/**
 * Cierra la evidencia del test: con EVIDENCE_CAPTURE=on-failure borra las capturas si el test
 * pasó. La llama automáticamente el fixture de lib/fixtures.js.
 * @param {import('@playwright/test').TestInfo} testInfo
 */
export function finalizeEvidence(testInfo) {
  const passed = testInfo.status === testInfo.expectedStatus;
  if (EVIDENCE_CAPTURE === 'on-failure' && passed) {
    for (const f of visualFiles) fs.rmSync(f, { force: true });
  }
  visualFiles = [];
}
