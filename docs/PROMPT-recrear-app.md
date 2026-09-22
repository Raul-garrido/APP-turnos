# Prompt para recrear la app "Cuadrante de turnos"

Copia todo lo que hay debajo de la línea y pégalo en la otra herramienta.

---

Quiero que construyas una aplicación web **PWA** (instalable en PC y móvil, que funcione sin conexión) llamada **"Cuadrante de turnos"**, en **español**, para que negocios pequeños y medianos (hasta 30-35 empleados, un solo centro y un solo convenio) generen cuadrantes de turnos por **equipos con rotación cíclica**. Soy principiante: explícame en lenguaje sencillo lo que hagas.

## Idea clave: el cuadrante se genera SOLO
El usuario **no diseña el patrón**: solo introduce los datos (turnos, equipos y personas, cobertura, festivos) y las reglas (Estatuto/convenio). La app **genera automáticamente** la rotación y el calendario, y los **vuelve a generar sola** cada vez que cambia algo que influye (equipos, turnos, cobertura, reglas). Escribir el patrón a mano queda solo como "modo avanzado" opcional.

## Cómo funciona por dentro (no es un asignador individual)
- Los empleados se agrupan en **equipos fijos** (número de equipos y personas por equipo configurables; los equipos pueden tener tamaños distintos).
- Hay **un único patrón de ciclo** (p. ej. `M M M M L L T T T T L L N N N N L L`, donde L = libre) que siguen **todos los equipos**, cada uno con un **desfase** en días.
- El día D (contado desde la "fecha de inicio del ciclo"), el equipo con desfase `o` está en la posición `(D − o) mod L` del patrón (L = longitud del ciclo). El calendario **no se guarda**: se calcula siempre a partir de la configuración. Solo se guardan configuración y excepciones.

## Stack
- React + Vite + TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), estado con **zustand** + `persist` en **localStorage** (clave `app-turnos`), `vite-plugin-pwa` (manifest en español, iconos 192/512 PNG, `registerType: 'autoUpdate'`), **ExcelJS** para Excel y **jsPDF + jspdf-autotable** para PDF (cargados con `import()` dinámico para no inflar la carga inicial), **Vitest** para pruebas.
- Sin backend en esta fase. Todo el cálculo en el navegador. Deja la capa de datos en un único fichero (store) para poder pasar más adelante a Supabase.
- `base` de Vite configurable con la variable de entorno `BASE_PATH` (para publicar en GitHub Pages bajo `/APP-turnos/`).
- Un workflow de GitHub Actions que en cada push ejecute `npm ci`, `npm test`, `npm run build` (con `BASE_PATH=/APP-turnos/`) y publique `dist` en GitHub Pages (`actions/upload-pages-artifact` + `actions/deploy-pages`).

## Estructura
- `src/engine/` — el motor, sin interfaz y con pruebas: `types.ts`, `dates.ts` (fechas como 'AAAA-MM-DD' y "número de día" UTC para evitar problemas de zona horaria; semana de lunes=0 a domingo=6), `shifts.ts`, `rules.ts`, `validation.ts`, `offsets.ts`, `calendar.ts`, `patternSearch.ts` (+ `patternSearch.worker.ts`), `defaults.ts`, `engine.test.ts`.
- `src/pages/`: Negocio, Normativa, Patrón y equipos, Calendario, Datos. `src/store/`: store y datos derivados. `src/export/`: Excel, PDF, tabla común, descarga.

## Modelo de datos
- **Turno**: id, letra (la L está reservada a libre; avisar si se repite), nombre, inicio y fin 'HH:MM' (si fin ≤ inicio, acaba al día siguiente), color, nocturno (sí/no), **máximo de días por semana en ese turno** (vacío = sin límite).
- **Equipo**: nombre, personas (id, nombre), desfase manual.
- **Cobertura**: modo "por equipos" o "por personas"; por cada turno un mínimo y los días de la semana en que se exige (todos = 24/7).
- **Festivos**: fecha + nombre.
- **Excepciones**: vacaciones, baja, permiso (rango de fechas), intercambio entre dos personas, cambio de turno (a un turno o a libre). Se aplican encima del patrón sin cambiarlo; orden: intercambios, cambios y, al final, ausencias.
- Modo de desfase: automático o manual.

## Reglas configurables y "marcos normativos"
Cada regla puede tener tres estados en cada marco: **"No lo regula"** (hereda), **"Sin límite / No se aplica"** (null) o **un valor**. Catálogo agrupado en Descansos / Cambios de turno / Jornada y vacaciones:
1. Descanso mínimo entre jornadas (h).
2. Periodo de cálculo del descanso semanal (7 o 14 días).
3. Descanso semanal ininterrumpido mínimo (h): cada periodo debe incluir (total o parcialmente) un descanso seguido de al menos esas horas, medido completo sin recortarlo por los bordes.
4. Días libres mínimos por semana (en ventana de 14 días se exige el doble).
5. Máximo de días seguidos trabajados.
6. ¿Turnos distintos en la misma semana?: "Sí, sin condiciones" / "Sí, solo tras descansar" / "No" (el "No" se comprueba sobre el calendario real de cada equipo, de lunes a domingo).
7. Días libres antes de cambiar de tipo de turno (se aplica con "solo tras descansar").
8. Máximo de noches seguidas.
9. Máximo de horas por jornada.
10. Máximo de horas semanales (media).
11. Jornada anual en horas. 12. Jornada anual en días.
13. Días de vacaciones al año. 14. Tipo de vacaciones: naturales o hábiles (hábiles = días en que a la persona le tocaba trabajar).
15. Festivos al año (14 por defecto). 16. ¿Qué pasa con los festivos?: "Se trabajan según el cuadrante" o "Se libran".
- **Marcos normativos**: conjuntos con nombre (tipo Estatuto / Convenio / Reglas propias) con valores para esas reglas. Se activan y se **ordenan**; los de abajo mandan sobre los de arriba, y al final van los **"Ajustes propios del negocio"**. Se pueden crear, duplicar, editar, eliminar, **importar y exportar en JSON**. Una tabla muestra el valor que se aplica de cada regla y de qué marco viene.
- Marco incluido (solo lectura, duplicable): **"Estatuto de los Trabajadores (referencia)"**: 12 h entre jornadas, máx. 9 h/jornada, 40 h/semana de media, descanso 36 h en 7 días, 30 días naturales de vacaciones, 14 festivos, con nota de que son valores orientativos a verificar.
- Convenio de ejemplo (editable): 12 h entre jornadas, 48 h de descanso semanal en 7 días, 2 días libres por semana, cambio de turno solo tras 2 días libres, 30 días naturales de vacaciones, jornada anual 221 días y 1.736 h, 14 festivos que se trabajan.

## Validación del patrón
El ciclo se trata como **circular**. Repite el patrón varias veces y comprueba los días de la copia central. Trabaja con minutos reales (los turnos de noche cruzan la medianoche). Comprueba todas las reglas anteriores y el máximo de días por semana de cada turno (en cualquier bloque de 7 días). Muestra los incumplimientos agrupados por regla (hasta 3 ejemplos + "y N más").

Estadísticas: días de trabajo/libres, horas por ciclo, media semanal, días y horas al año con y sin descontar vacaciones (vacaciones naturales: se pierden `vacaciones × días_trabajo/L` días; hábiles: `vacaciones` días; si los festivos se libran, se restan también `festivos × días_trabajo/L`).

El exceso o defecto frente a la jornada anual **no es un error**: es un aviso "Exceso de jornada: hay que dar X días (Y h) libres" o "Defecto: faltan X".

## Desfases automáticos (offsets.ts)
- Comprobación previa de viabilidad por turno: `peso_total × apariciones_del_turno / L ≥ mínimo`; si no, avisar "con este patrón es imposible cubrir X, añade equipos o días".
- Periodo de evaluación: L días, o `mcm(L, 7)` si la cobertura depende del día de la semana.
- Puntuación lexicográfica (requisito fijo):
  1. Menos huecos de cobertura.
  2. **Maximizar los fines de semana completos (sábado y domingo) libres del equipo que menos libra** (reparto justo).
  3. Maximizar los fines de semana completos totales.
  4. Maximizar los sábados o domingos sueltos.
  5. Reparto equilibrado de lo que sobra (mínima suma de cuadrados).
- Precalcula, para cada desfase posible, los fines de semana completos y medios en un periodo `mcm(L, 7)`.
- Búsqueda exhaustiva si hay pocas combinaciones (equipos iguales → combinaciones no decrecientes con el primero en 0, más los L desplazamientos globales). Si hay demasiadas, búsqueda por mejora con 30 arranques aleatorios con semilla fija.
- Mostrar el desfase de cada equipo, si la cobertura está garantizada, y los fines de semana libres al año de cada equipo (completos y medios), con una nota: si L no es múltiplo de 7, con el tiempo todos libran los mismos fines de semana; si lo es, cada equipo libra siempre los mismos días de la semana.

## Generador automático del patrón (patternSearch.ts) — es el flujo principal
- Se ejecuta **solo**: un hook montado en la raíz calcula una "huella" (tamaños de equipos, turnos con horas/nocturno/máx. por semana, cobertura, modo de cobertura, reglas efectivas, prioridad y semilla). Si difiere de la huella guardada con el último patrón generado, espera 700 ms (por si el usuario sigue escribiendo) y lanza la generación en un **Web Worker**. Al terminar guarda el patrón, pone la fecha de inicio en lunes y los desfases de una semana por equipo, y guarda la huella. Mientras genera, aparece una barra "Generando el cuadrante automáticamente…"; si no consigue cumplir todo, una barra roja lo explica.
- Diseña un ciclo de **tantas semanas como equipos** (7 equipos → 49 días) con desfases de una semana por equipo (0, 7, 14…). Así la cobertura de cada día de la semana es la suma de todas las semanas del ciclo.
- Cada semana del ciclo = un tipo de turno + una máscara de 7 días de trabajo (solo máscaras con al menos los días libres por semana exigidos).
- **Recocido simulado** (12.000 iteraciones, 3 reinicios, semilla configurable). Movimientos: cambiar un día, cambiar el turno de una semana, intercambiar dos semanas, nueva máscara o nueva semana al azar.
- Coste: `huecos×10000 + incumplimientos×1000 − findes_completos×peso − findes_medios×5 + |días_netos − jornada_anual|×peso2 + bloques_de_trabajo×2`. Prioridad "Máximos fines de semana" (peso 100, peso2 1) o "Equilibrio con la jornada anual" (20 y 6). Descarta sin validar del todo los candidatos que empeoran mucho la cobertura, para ir rápido.
- Máximo teórico de semanas con fin de semana completo = `equipos − equipos que tienen que trabajar el sábado/domingo`.
- La pantalla "Rotación y jornada" muestra la rotación generada (tabla Semana 1…N × L M X J V S D), fines de semana completos por equipo frente al máximo posible, el selector de prioridad ("Máximos fines de semana libres" o "Fines de semana y ajustarse a la jornada anual"), un botón "Generar otra opción" (cambia la semilla y regenera) y un enlace "Prefiero escribir el patrón a mano (avanzado)". En modo avanzado aparecen el editor del patrón, el cálculo de desfases automático/manual y un botón "Volver a generación automática".
- Con 7 equipos de 4 personas, M/T/N 24/7 con 1 equipo por turno y el convenio de ejemplo, debe encontrar **30 fines de semana completos al año (el máximo)**, cumpliendo todo, en unos 2 segundos.

## Balance de jornada anual (por equipo y año, con selector de año)
Columnas: días de trabajo en el cuadrante, festivos que caen en día de trabajo (fechas reales si se han introducido para ese año; si no, estimación con "festivos al año"), días de trabajo perdidos por vacaciones, **días y horas efectivos**, **exceso en días y en horas** (positivo = días a dar libres; negativo = faltan). Muestra jornada anual del convenio, vacaciones y cómo se tratan los festivos.

## Pantallas
Orden de pestañas: 1. Negocio, 2. Normativa, 3. Cuadrante, Rotación y jornada, Datos.

1. **Negocio**: nombre, fecha de inicio del ciclo, tabla de turnos (con "Máx. días/semana"), equipos (generador "N equipos de M personas", renombrar, añadir, quitar o mover personas entre equipos), cobertura (modo y mínimo por turno con botones L M X J V S D), festivos.
2. **Normativa**: lista de marcos (activar, ordenar ↑↓, ver/editar, duplicar, exportar, eliminar, importar, nuevo convenio), editor de reglas con los tres estados, ajustes propios del negocio, tabla "Reglas que se aplican ahora".
3. **Cuadrante** (el calendario generado):
   - Vistas semana / mes / año, con navegación y botón "Hoy". En semana y mes: filas por persona agrupadas por equipo. En año: una tabla por mes, filas por equipo.
   - Festivos resaltados; cambios manuales marcados con borde rojo y el turno original en el tooltip. Pulsar una casilla abre el formulario de excepción con la persona y la fecha ya puestas.
   - Filas de cobertura diaria en verde o rojo, avisos de cobertura (turnos bajo mínimo, equipos con ausencias).
   - Lista de excepciones y contador de vacaciones por persona (usadas / pendientes, naturales o hábiles).
   - Exportar a **Excel** (colores por turno, festivos, bordes rojos en cambios, cobertura, leyenda, aviso legal; una hoja por mes en vista anual) y **PDF** (A4 horizontal, una página por semana/mes).
4. **Rotación y jornada**:
   - Rotación generada automáticamente (ver arriba) y comprobación de reglas.
   - Desfases de cada equipo con la nota de rotación equitativa y los fines de semana por equipo.
   - Balance de jornada anual y vista previa con la cobertura diaria.
   - En modo avanzado: editor del patrón (texto con o sin espacios, casillas que cambian al pulsarlas, botones "+M +T +N +L" y "Quitar último").
5. **Datos**: aviso de que los datos están solo en este navegador, descargar/restaurar copia de seguridad JSON, restablecer el ejemplo.

## Aviso legal (siempre visible)
Barra fija abajo en todas las pantallas y en las exportaciones: "Aviso: esta herramienta organiza turnos según los parámetros introducidos por el usuario. No es asesoría legal ni garantiza el cumplimiento normativo. La verificación del convenio aplicable es responsabilidad del usuario."

## Datos de ejemplo al arrancar
7 equipos de 4 personas ("Persona 1…28"), turnos Mañana 06–14, Tarde 14–22, Noche 22–06 (nocturno), cobertura 1 equipo por turno todos los días, patrón `M M M M L L T T T T L L N N N N L L`, marcos activos Estatuto + convenio de ejemplo, fecha de inicio = lunes de la semana actual.

## Pruebas mínimas (Vitest)
- Lectura del patrón en texto.
- Descanso N→M = 0 h; ciclo circular; días seguidos.
- Cambio de turno tras descanso; 48 h y 2 días libres.
- Jornada anual (223 días con el ejemplo) y festivos que se libran (214).
- Máximo de días por semana por turno.
- Orden de marcos y `null` que desactiva.
- 5 equipos con ciclo de 10 → desfase de 2 y cobertura exacta; 7 equipos con ciclo de 10 con cobertura; 4 equipos imposible.
- Fines de semana: con `M M M M M L L` y 7 equipos, 6 equipos libran todos.
- Reparto justo con el ciclo de 18.
- Calendario con excepciones, vacaciones naturales y hábiles, balance anual con festivos reales.
- El buscador de patrón encuentra 0 huecos, 0 incumplimientos y el máximo teórico de 30.

Diseño: limpio, colores suaves por turno, usable en móvil (tablas con scroll horizontal propio). Evita `alert`/`confirm` si la plataforma no los permite y usa confirmaciones dentro de la página.
