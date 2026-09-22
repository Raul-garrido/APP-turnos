# Cuadrante de turnos (PWA)

Aplicación web para generar cuadrantes de turnos por **equipos con rotación cíclica**:
se define un único patrón (p. ej. `M M M M L L T T T T L L N N N N L L`) y la app
calcula el desfase de cada equipo para cubrir todos los turnos, comprueba las reglas
de descanso y jornada, y genera el calendario (semana, mes y año) con excepciones.

> Aviso: la herramienta organiza turnos según los parámetros introducidos por el usuario.
> No es asesoría legal ni garantiza el cumplimiento normativo.

## Cómo arrancarla en tu ordenador

Necesitas [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install      # instala las dependencias (solo la primera vez)
npm run dev      # abre la app en http://localhost:5173
npm test         # ejecuta las pruebas del motor de turnos
npm run build    # genera la versión para publicar (carpeta dist/)
```

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `src/engine/` | El "cerebro": rotación, desfases, validación de reglas, calendario. Sin interfaz, con pruebas (`engine.test.ts`). |
| `src/engine/rules.ts` | Catálogo de reglas configurables y marcos normativos incluidos (Estatuto). |
| `src/engine/defaults.ts` | Ejemplo con el que arranca la app (7 equipos de 4 personas, convenio de ejemplo). |
| `src/pages/` | Pantallas: Negocio, Normativa, Patrón y equipos, Calendario, Datos. |
| `src/store/` | Dónde se guardan los datos (ahora en el navegador; más adelante, en la nube). |
| `src/export/` | Exportación a Excel y PDF. |

## Publicarla gratis

Cualquier hosting de webs estáticas sirve (Cloudflare Pages, Netlify...):
comando de build `npm run build`, carpeta de salida `dist`.
