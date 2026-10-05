# Datos de prueba

El objetivo es que la suite se pueda correr muchas veces seguidas, en cualquier ambiente, sin
ensuciarlo más de lo necesario y sin que una corrida rompa la siguiente.

## Reutilizar o crear
- **Reutilizar** entidades existentes es lo preferible cuando el ambiente es compartido o el
  usuario lo pide (p. ej. "no crear viajes nuevos"): consulta una vez en `beforeAll` (o lee
  `FIXTURE_IDS` del env) y reparte con `createPool(ids).take(n)` sin repetir entre tests, para
  que un test no edite lo que otro acaba de editar.
- **Crear** por API es válido cuando el caso necesita un estado inicial controlado y el
  ambiente lo permite. Hazlo en el propio test o en `beforeAll`, con un prefijo reconocible
  (`QA-AUTO-...`) y sin guardar evidencia de esa preparación.
- **Pregunta** al usuario si no está claro cuál de las dos aplica: crear datos en un ambiente
  compartido puede no estar permitido.

## Evitar choques entre corridas
- Fechas: `futureRange({ minDays: 7, maxDays: 97 })` — desfase aleatorio de días y minutos.
  Muchos backends rechazan solapamientos de fechas para la misma entidad.
- Coordenadas: `jitter(punto, 0.005)` sobre puntos reales que el servicio de geocodificación
  resuelve; coordenadas exactamente iguales o inventadas producen errores que no son el
  objeto de la prueba.
- Identificadores de cliente/índice: incluir el TC y la variante (`EDIT-TC1002-51-${i}`) ayuda
  a rastrear en la base qué escribió cada test.

## Cuando faltan datos
`test.skip(!ids, 'Faltan N IDs en FIXTURE_IDS (quedan M)')`. Un skip con motivo queda como
NotExecuted y explica qué falta; un fallo por falta de datos se confunde con un defecto.

## Valores límite y negativos
- Toma los valores literales de la tabla de parámetros del caso (49/50/51, -90.1/90.1,
  4 MB/5 MB/6 MB). No "redondees" ni agregues valores que el caso no pide; si crees que falta
  un valor importante, ponlo en las exploratorias.
- Para "dato inválido" usa la forma mínima que provoca el error (un campo a `null`, un id
  inexistente como `999999999`) y deja el resto del ítem válido, así el mensaje observado es
  atribuible a ese campo.
