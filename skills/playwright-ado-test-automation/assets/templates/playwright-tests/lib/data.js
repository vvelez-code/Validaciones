// @ts-check
/**
 * Utilidades de datos de prueba. Ver references/test-data.md para el porqué de cada una.
 */

/** Fechas futuras con desfase aleatorio de días para que corridas sucesivas no choquen. */
export function futureRange({ minDays = 7, maxDays = 97, durationHours = 4 } = {}) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + minDays + Math.floor(Math.random() * (maxDays - minDays)));
  start.setUTCMinutes(Math.floor(Math.random() * 60), 0, 0);
  const end = new Date(start.getTime() + durationHours * 3600_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Variación pequeña sobre una coordenada real (sigue siendo resoluble, pero no idéntica). */
export function jitter({ lat, lon, ...rest }, delta = 0.005) {
  const d = () => (Math.random() * 2 - 1) * delta;
  return { lat: +(lat + d()).toFixed(6), lon: +(lon + d()).toFixed(6), ...rest };
}

/**
 * Reparte un pool de IDs existentes sin repetir entre tests.
 * Devuelve null si no alcanzan: el test debe hacer test.skip(true, motivo).
 */
export function createPool(ids) {
  const free = [...ids];
  return {
    take(n) { return free.length >= n ? free.splice(0, n) : null; },
    get remaining() { return free.length; },
  };
}

/**
 * CSV con la misma forma que la plantilla real del front (confirmarla descargándola en la
 * exploración: separador, encabezados exactos, línea `sep=,` inicial, BOM…).
 */
export function toCsv(headers, rows, { sepLine = false, bom = false } = {}) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [...(sepLine ? ['sep=,'] : []), headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))];
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

/**
 * Reintenta solo ante errores transitorios que NO son lo que se prueba.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {(r: T) => boolean} isTransient  true si el resultado es un error transitorio conocido
 */
export async function retryTransient(fn, isTransient, { retries = 3, delayMs = 2000, label = '' } = {}) {
  let result;
  for (let attempt = 0; attempt <= retries; attempt++) {
    result = await fn();
    if (!isTransient(result) || attempt === retries) return result;
    console.log(`    ⏳ Error transitorio ${label} (intento ${attempt + 1}/${retries}), reintentando...`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return result;
}
