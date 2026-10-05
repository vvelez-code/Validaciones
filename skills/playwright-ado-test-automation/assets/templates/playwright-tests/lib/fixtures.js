// @ts-check
/**
 * `test` y `expect` de la suite. Importa SIEMPRE desde aquí en lugar de '@playwright/test':
 * el fixture automático cierra la evidencia de cada test según EVIDENCE_CAPTURE
 * (ver lib/evidence.js), sin que cada test tenga que acordarse de hacerlo.
 */
import { test as base, expect } from '@playwright/test';
import { finalizeEvidence } from './evidence.js';

export const test = base.extend({
  _evidence: [async ({}, use, testInfo) => {
    await use(undefined);
    finalizeEvidence(testInfo);
  }, { auto: true }],
});

export { expect };
