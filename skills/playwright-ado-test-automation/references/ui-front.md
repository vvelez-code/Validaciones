# Variante UI — validación sobre la pantalla real del front

Úsala cuando el caso describe lo que el usuario ve y hace: pantallas, botones, cargas de
archivo, mensajes, descargas.

## Principio
Se valida **la pantalla**, no la API que hay detrás. La API solo se usa para preparar datos
(p. ej. obtener IDs existentes con un login técnico). Si un caso de UI se "valida" por API, un
defecto del front (botón que no se deshabilita, mensaje engañoso) pasaría como Passed.

## Pasos
1. **Login del front** con el usuario del front (`FRONT_EMAIL`/`FRONT_PASSWORD`). Espera un
   elemento que solo existe autenticado en lugar de un `waitForTimeout` fijo: un sleep esconde
   logins fallidos y luego el error aparece en otro paso, confundiendo el diagnóstico.
2. **Navegación** a la pantalla y apertura del modal/sección, con `withRetries` (las SPA
   fallan a veces en la primera carga; eso no es lo que se prueba).
3. **Entrada.**
   - Cargas masivas: descarga primero la plantilla real en la exploración y replica su forma
     exacta (`toCsv`: encabezados, orden, `sep=,` inicial, BOM, fin de línea). Guarda el
     archivo subido como evidencia `input.csv`: es lo primero que alguien pide ver cuando un
     resultado no cuadra.
   - Archivos de formato o tamaño inválido: genéralos en el test (CSV renombrado a `.pdf`,
     relleno hasta N MB) y guárdalos igual.
4. **Lectura del resultado.**
   - Avisos modales (SweetAlert2 por defecto: `.swal2-title`, `.swal2-html-container`) →
     `readDialogIfAny`, que devuelve `{ title, text }` o `null` si no hubo aviso.
   - Paneles de resultados → `innerText` del modal y `parseCounters` para
     `Enviados/Exitosos/Fallidos`; filas de detalle con split por tabulador.
   - Estado de controles (`isEnabled`, `isVisible`) cuando el caso habla de "no permite
     continuar".
5. **Evidencia.** `pantalla.png` (página completa, después de leer el resultado) y
   `resultado.json` con `{ variante, filas, aviso, resultado, botonHabilitado }`.
   El video lo graba Playwright según `EVIDENCE_CAPTURE` (`always` → todos, `on-failure` →
   solo fallidos) y `qa-validate.py` lo adjunta a ADO como `TC-<id>-<slug>.webm`. Si el
   usuario pide video de cada ejecución, eso es `EVIDENCE_CAPTURE=always`. Ojo: el video
   muestra todo lo que aparece en pantalla (no se enmascara); si la pantalla tiene datos
   personales reales, coméntalo con el usuario antes de dejarlo en `always`.

## Aserciones típicas
```js
expect(aviso, `Aviso inesperado: ${JSON.stringify(aviso)}`).toBeNull();
expect(resultado).toMatchObject({ enviados: 3, exitosos: 3, fallidos: 0 });
expect(aviso?.text ?? '').toMatch(/máximo/i);
expect(botonHabilitado).toBe(false);
```

## Flakiness
- `retries: 2` en `playwright.config.js` (`PW_RETRIES=2`) para la variante UI: `qa-validate.py`
  cuenta solo el último intento, así un timeout de infraestructura seguido de un éxito queda
  Passed, pero el intento fallido sigue visible en el comentario de ADO.
- No confundas un timeout de infraestructura con un fallo de negocio: si el mensaje de error
  es de navegación/timeout, revisa el video antes de reportar un defecto.
- Errores intermitentes del backend que aparecen en la pantalla ("error inesperado al
  procesar") → reintento con regex explícita y datos frescos, nunca un reintento ciego.

## Lo que no se puede reproducir desde la UI
Caídas del servicio, timeouts del backend, estados imposibles de alcanzar en el ambiente:
`test.skip(true, '<motivo>')` y una línea en "Límites conocidos" de FLUJO-VALIDACION.md.
