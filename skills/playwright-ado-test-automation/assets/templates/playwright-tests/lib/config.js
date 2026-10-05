// @ts-check
/**
 * Configuración por ambiente.
 *
 * TEST_ENV=<nombre> elige el ambiente (por defecto "test").
 * - "test" lee el archivo `env`.
 * - Cualquier otro lee SOLO `env.<nombre>`.
 * No hay valores por defecto en el código: si falta una variable obligatoria la suite falla con
 * un mensaje claro. Así nunca se mezclan URLs/datos de un ambiente con otro y no quedan
 * credenciales escritas en archivos que se versionan.
 */
import fs from 'fs';
import path from 'path';

export const TEST_ENV = (process.env.TEST_ENV || 'test').trim().toLowerCase();
export const IS_DEFAULT_ENV = TEST_ENV === 'test';
export const ENV_FILE = path.join(process.cwd(), IS_DEFAULT_ENV ? 'env' : `env.${TEST_ENV}`);

/** Carga KEY=VALUE sin pisar variables ya definidas en el proceso (útil en CI). */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (process.env[key.trim()] === undefined) process.env[key.trim()] = rest.join('=').trim();
  }
}

if (!fs.existsSync(ENV_FILE) && !process.env.CI) {
  throw new Error(`No existe "${path.basename(ENV_FILE)}" para el ambiente "${TEST_ENV}". Créalo a partir de env.example.`);
}
loadEnvFile(ENV_FILE);

/** Variable obligatoria. */
export function cfg(key) {
  const value = process.env[key];
  if (!value || value.startsWith('<')) {
    throw new Error(`Falta ${key} en ${path.basename(ENV_FILE)} (ambiente "${TEST_ENV}"). Ver env.example.`);
  }
  return value;
}

/** Variable opcional: los tests que la necesiten deben hacer test.skip si viene vacía. */
export function optionalCfg(key, fallback = '') {
  const value = process.env[key];
  return value && !value.startsWith('<') ? value : fallback;
}

export const REQUEST_TIMEOUT_MS = Number(optionalCfg('REQUEST_TIMEOUT_MS', '45000'));
