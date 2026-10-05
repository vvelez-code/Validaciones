// @ts-check
/**
 * Suite de validación API — <NOMBRE DE LA SUITE>
 * Automatiza los casos reales de la Suite ADO <SUITE_ID> (Plan <PLAN_ID>).
 *
 * Endpoint bajo prueba: <MÉTODO> <RUTA>        (ejemplo: PUT /api/v1/orders/bulk-update)
 * Evidencia por ejecución: swagger-01-request.png, swagger-02-response.png, request.json, response.json
 *
 * Renombra este archivo a <suite>.spec.js. Los TC, variantes y mensajes de abajo son
 * EJEMPLOS: reemplázalos por los pasos y parámetros literales del caso en ADO
 * (test-cases.json) y por los mensajes reales confirmados en la exploración.
 */
// test/expect desde lib/fixtures.js: cierra la evidencia según EVIDENCE_CAPTURE.
import { test, expect } from './lib/fixtures.js';
import { cfg, optionalCfg, TEST_ENV, REQUEST_TIMEOUT_MS } from './lib/config.js';
import { startEvidence } from './lib/evidence.js';
import { executeInSwagger, swaggerMask } from './lib/swagger.js';
import { retryTransient } from './lib/data.js';

const API_BASE_URL = cfg('API_BASE_URL').replace(/\/+$/, '');
const AUTH_LOGIN_URL = optionalCfg('AUTH_LOGIN_URL');          // vacío si la API es pública
const SWAGGER_URL = optionalCfg('SWAGGER_URL', `${new URL(API_BASE_URL).origin}/swagger/index.html`);
const OPERATION_ID = '#operations-<Tag>-<operationId>';        // confirmar en la exploración

console.log(`🌐 Ambiente: ${TEST_ENV} | API: ${API_BASE_URL}`);

/** Login por API. Ajusta el cuerpo y la ruta del token a la respuesta real del servicio. */
async function login(request) {
  if (!AUTH_LOGIN_URL) return '';
  const res = await request.post(AUTH_LOGIN_URL, {
    data: { username: cfg('AUTH_EMAIL'), password: cfg('AUTH_PASSWORD') },
    timeout: REQUEST_TIMEOUT_MS,
  });
  expect(res.ok(), `Login falló con HTTP ${res.status()}`).toBeTruthy();
  const json = await res.json();
  const token = json?.data?.token ?? json?.token ?? json?.access_token;
  expect(token, 'La respuesta de login no trae token').toBeTruthy();
  return token;
}

// Errores del ambiente que NO son lo que se prueba (confírmalos en la exploración).
const TRANSITORIO_RE = /saldo no disponible|temporarily unavailable|timeout/i;
const esTransitorio = (r) => r.status >= 500 || TRANSITORIO_RE.test(JSON.stringify(r.body ?? ''));

/**
 * Una ejecución completa = una evidencia: capturas de Swagger + request.json + response.json,
 * todo con el mismo prefijo. Cada reintento crea su propia evidencia.
 */
async function ejecutar(page, token, tcId, variante, body) {
  return retryTransient(async () => {
    const ev = startEvidence(tcId, variante, { mask: swaggerMask });
    ev.json('request', body);
    const result = await executeInSwagger(page, {
      swaggerUrl: SWAGGER_URL, operationId: OPERATION_ID, body, token, evidence: ev, timeoutMs: REQUEST_TIMEOUT_MS,
    });
    ev.json('response', result);
    return result;
  }, esTransitorio, { label: tcId });
}

// Construye un ítem válido del lote. Reemplaza por el contrato real.
function itemValido(i) {
  return { id: `<ID_EXISTENTE_${i}>`, field: 'value' };
}

test.describe('<NOMBRE DE LA SUITE> - Suite ADO <SUITE_ID>', () => {
  /** @type {string} */
  let token;
  test.beforeAll(async ({ request }) => { token = await login(request); });

  // TC-<id> (Point <point>): <título literal del caso en ADO>
  test('TC-1001: Lote válido - responde 200 con todos los ítems exitosos', async ({ page }) => {
    const body = { items: [itemValido(1), itemValido(2)] };
    const { status, body: res } = await ejecutar(page, token, 'TC-1001', '', body);

    expect(status).toBe(200);
    expect(res.data.totalExitosos, `Fallidos: ${JSON.stringify(res.data.fallidos)}`).toBe(2);
  });

  // Caso con tabla de parámetros en ADO (@Cantidad): un test por fila, variante = valor.
  test.describe('TC-1002: Límite de ítems por solicitud', () => {
    const filas = [
      { cantidad: 49, status: 200 },
      { cantidad: 50, status: 200 },
      { cantidad: 51, status: 400, mensaje: /máximo de 50/i },
    ];
    for (const f of filas) {
      test(`TC-1002: ${f.cantidad} ítems - HTTP ${f.status}`, async ({ page }) => {
        const body = { items: Array.from({ length: f.cantidad }, (_, i) => itemValido(i + 1)) };
        const { status, body: res } = await ejecutar(page, token, 'TC-1002', String(f.cantidad), body);

        expect(status).toBe(f.status);
        // Las respuestas de error pueden venir con otra convención (Errors vs errors).
        if (f.mensaje) expect(JSON.stringify(res)).toMatch(f.mensaje);
      });
    }
  });

  // Paso que el ambiente no permite reproducir: se salta con motivo (queda NotExecuted).
  test('TC-1003: Ítem en estado Finalizado - se rechaza', async () => {
    test.skip(true, 'No existe en este ambiente un endpoint para llevar un ítem a "Finalizado"; no se simula el resultado.');
  });
});
