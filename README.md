# Aegon

Herramienta para diseñar arquitectura con el modelo **C4** (niveles 1 a 3): un lienzo moderno y
fluido, un modelo único guardado como código (YAML, un archivo por entidad) y pensada desde el
inicio para trabajar con agentes de IA.

Toma como base a IcePanel, suma la flexibilidad de Enterprise Architect y la soltura de draw.io.

## Probar y descargar

- **En el navegador, sin instalar nada:** <https://crisd404.github.io/Aegon/>. Arranca con un
  workspace de ejemplo (banca digital); lo que hagas queda en tu navegador.
- **App de escritorio:** el [último release](https://github.com/CrisD404/Aegon/releases/latest)
  trae instaladores para Windows (MSI, instalador `.exe` y versión portable), macOS (DMG universal,
  Apple Silicon e Intel) y Linux (AppImage, `.deb` y `.rpm`). No están firmados: las notas de cada
  release explican cómo abrirlos la primera vez.

Cada push a `main` publica la web y un release nuevo (`v0.1.<n>`) con el changelog: ver
[`.github/workflows`](.github/workflows).

## Estado

**Fase 0 · Fundaciones**, **Fase 1 · Lienzo MVP**, **Fase 2 · Escritorio + Git**,
**Fase 3 · IA first**, **Fase 4 · Escala y layout** y **Fase 5 · FinOps y ambientes** listas,
más **flujos** y **comentarios**.

Flujos y comentarios (ver [`docs/format.md`](docs/format.md#flujos)):

- **Flujos:** secuencias de pasos (mensajes entre elementos, procesos, notas, caminos alternativos
  o paralelos y saltos a otros flujos) que se editan en la pestaña **Flujos** del explorador.
  "+ Paso" usa lo seleccionado en el lienzo (una relación → mensaje; un elemento → proceso) o deja
  elegir origen y destino tocando el lienzo. **Reproducir** abre una presentación: portada con los
  pasos, cámara que viaja a cada paso (abre el L2 o L3 que lo muestra), relación animada en el
  sentido del mensaje, rastro numerado, subtítulo con el detalle, elección de caminos,
  reproducción automática y teclado (`←` `→`, `Espacio`, `A`, `Esc`). Se copian como texto o
  como diagrama de secuencia de Mermaid.
- **Comentarios:** `C` (o el botón del dock) y un click en el lienzo; sobre un elemento quedan
  anclados a él. Ícono y color a elección, respuestas, editar, resolver, ampliar en un modal y
  arrastrar. La pestaña **Comentarios** los lista por lienzo (abiertos/resueltos, búsqueda) y al
  tocar uno lo abre en su lienzo.

Fase 5 (ver [`docs/format.md`](docs/format.md#ambientes-y-costos-finops)):

- **Ambientes** (desarrollo, QA, producción…) definidos en el workspace, con presupuesto mensual y
  moneda. Cada elemento indica dónde está desplegado y su costo mensual por ambiente (réplicas,
  SKU), con etiquetas FinOps (`cost-center`, `project`…) que se heredan del padre.
- **Capa de costos** en el lienzo (`C`): badges con el costo de cada nodo (incluye lo que contiene)
  coloreados por peso, total del lienzo y filtro por ambiente que atenúa lo que no está desplegado.
- **Panel Costos:** total contra presupuesto, reparto por ambiente, sistema, grupo (cloud,
  datacenter) y etiqueta, elementos sin costo cargado y export CSV.

Fase 4:

- **Auto-layout con ELK** (`Shift+L`) en un Web Worker: capas de arriba hacia abajo, grupos como
  marcos que envuelven a sus miembros, actores arriba; los nodos se animan hasta su lugar y se
  deshace en un paso. Con una selección, ordena solo esos elementos.
- **Parseo y guardado del YAML en un worker** para workspaces grandes: abrir o guardar miles de
  archivos no congela la interfaz.
- **Búsqueda en el lienzo** (`Ctrl+F`): resalta coincidencias (nombre, tecnología, tags, motor) y
  las recorre con `Enter`. **Modo foco** (`Shift+F`): atenúa lo que no es dependencia directa de la
  selección. **Minimapa** (`M`).
- **Rendimiento:** el nivel de detalle llega a los nodos por contexto (no una suscripción al zoom
  por nodo) y el lienzo ya no se re-renderiza en cada cuadro de zoom. Benchmarks en `pnpm bench`.

Fase 3 (ver [`docs/agents.md`](docs/agents.md)):

- **Servidor MCP** (`@aegon/mcp`, stdio): herramientas 1:1 con las operaciones del modelo (listar y
  ver elementos, relaciones y lienzos; agregar, modificar y eliminar; conectar; ubicar; abrir el
  L2/L3), más `validate`, `analyze` y `export`. Cada escritura pasa por `applyOp` (que valida las
  reglas C4) y se guarda en disco: la app de escritorio la muestra en vivo como un cambio.
- **CLI `aegon`** (Node 24, TypeScript sin compilar): `init`, `validate`, `lint`, `add`, `connect`,
  `layout`, `diff [ref]` y `export mermaid|plantuml-c4|structurizr|json`, con `--json` para scripts.
- **Análisis:** huérfanos, ciclos de dependencias (también entre niveles), violaciones de C4,
  relaciones sin protocolo (con sugerencias según el destino) y hotspots de riesgo.
- **Exportadores** a Mermaid, C4-PlantUML, Structurizr DSL y JSON, en `@aegon/core`.
- [`llms.txt`](llms.txt) y un `AGENTS.md` en cada workspace para agentes sin MCP.

Fase 2:

- **App de escritorio (Tauri 2):** la misma UI con acceso nativo a la carpeta, el `git` del
  sistema (tus credenciales y configuración) y un observador de archivos: si un editor, un agente
  de IA o un `git checkout` cambian los YAML, la app los toma sola y los combina con tu borrador.
- **Sincronización con git:** la pestaña Cambios muestra la rama, commits adelante/atrás,
  **Actualizar** (pull) y **Commit & push** con mensaje autogenerado y editable.
- **Merge semántico por entidad:** los archivos del modelo no se combinan línea por línea sino
  elemento por elemento y campo por campo (en los lienzos, nodo por nodo). Dos personas que
  editan cosas distintas nunca chocan; si cambian el mismo campo, un diálogo muestra tuyo/remoto
  y elegís. El resto del repo (README, código) lo combina git normalmente.
- **GitHub desde el navegador:** "Abrir desde GitHub" y "Publicar en GitHub" con un token
  fine-grained (queda solo en el navegador). Usa la Git Data API sin backend y solo descarga los
  archivos que cambiaron (compara hashes git localmente).

Fases 0 y 1:

- **Lienzo** (ReactFlow): todos los elementos comparten un rectángulo compacto; el tipo se lee en
  la franja de color y en la forma del chip (círculo = actor, cilindro = base de datos, píldora =
  bus de mensajería, cuadrado = sistema/contenedor/componente). Grupos cloud/on-prem/red, relaciones
  flotantes con etiqueta y protocolos, relaciones **implícitas** entre niveles (una por par) y marco
  del sistema/contenedor abierto. Al seleccionar un elemento, las flechas hacia sus dependencias se
  animan.
- **Reglas C4:** una sola relación por par (conectar al revés la vuelve bidireccional), catálogos
  separados de tecnologías, motores de BD, brokers de mensajería y protocolos (estos últimos
  sugeridos según el destino).
- **Componente fantasma:** doble click en el lienzo, escribís un nombre y elegís crear o **linkear
  un elemento existente** del modelo. Detecta motores de BD (`post` → PostgreSQL) y proveedores
  (`aws` → grupo AWS). Soltar una conexión en el vacío también abre el fantasma.
- **Niveles:** doble click en un sistema abre sus contenedores (L2), en un contenedor sus
  componentes (L3); breadcrumbs y `Alt ↑` para subir.
- **Explorador** virtualizado: modelo (filtros L1/L2/L3), grupos por proveedor, lienzos y
  dependencias del elemento seleccionado; arrastrar al lienzo ubica el elemento.
- **Inspector** por tipo: actor (interno/externo, rol), base de datos (motor del catálogo u "otro"
  con ícono propio), grupo (proveedor, región, CIDR), tecnología con autocompletado, riesgo,
  estado, tags, links, documentación, propiedades.
- **Grilla, reglas y guías:** grilla de puntos/líneas, snap, reglas, **Shift al arrastrar** para
  guías de alineación con snap, `Shift+L` para ordenar automáticamente (por capas).
- **Acciones rápidas:** paleta `Ctrl+K`, menús contextuales, barra de alineación sobre la
  selección, copiar/pegar (pegar en otro lienzo linkea), duplicar, deshacer/rehacer.
- **Borrador local + pestaña Cambios:** cada edición se guarda como borrador (IndexedDB); la
  pestaña lista el diff semántico, permite revertir cambios puntuales y guardar. Mensaje de commit
  autogenerado.
- **Workspaces:** en el navegador o vinculados a una carpeta local (File System Access API).
- **Tema claro/oscuro/sistema**, animaciones con soporte de `prefers-reduced-motion`.

## Empezar

Requiere Node 22+ y pnpm (la CLI y el servidor MCP, Node 24).

```bash
pnpm install
```

```bash
pnpm dev
```

Abre `http://localhost:5180`. El primer arranque crea un workspace de ejemplo (banca digital).

### App de escritorio

Requiere Rust (`winget install Rustlang.Rustup`) y, en Windows, las Visual Studio Build Tools con
el workload de C++. WebView2 ya viene con Windows 11.

```bash
pnpm desktop:dev
```

```bash
pnpm desktop:build
```

El ejecutable queda en `apps/desktop/src-tauri/target/release/aegon.exe`. Para un instalador
(MSI/NSIS) usá `pnpm --filter @aegon/desktop build`.

### CLI y servidor MCP

```bash
pnpm aegon validate -w fixtures/demo
```

```bash
claude mcp add aegon -- node C:/Projects/Aegon/packages/mcp/src/main.ts --workspace C:/ruta/a/mi-arquitectura
```

Comandos, herramientas y prompts de ejemplo en [`docs/agents.md`](docs/agents.md).

| Script | Qué hace |
|---|---|
| `pnpm dev` | App en modo desarrollo (puerto 5180) |
| `pnpm build` | Typecheck de todos los paquetes + build de la app |
| `pnpm test` | Tests unitarios (vitest) |
| `pnpm test:e2e` | Tests e2e (Playwright). Con `PLAYWRIGHT_CHANNEL=msedge` usa el Edge instalado |
| `pnpm desktop:dev` / `pnpm desktop:build` | App de escritorio en desarrollo / ejecutable de release |
| `pnpm test:desktop` | E2E de la app de escritorio real (lanza el `.exe` y se conecta a WebView2) |
| `pnpm gen:schema` | Regenera los JSON Schema en `docs/schema/` |
| `pnpm gen:large` | Genera un workspace de ~5k elementos en `fixtures/large/` |
| `pnpm aegon <comando>` | CLI de Aegon (`validate`, `lint`, `add`, `connect`, `layout`, `diff`, `export`) |
| `pnpm mcp -- --workspace <carpeta>` | Servidor MCP por stdio (para probarlo a mano; los clientes lo lanzan solos) |

## Atajos

| Atajo | Acción |
|---|---|
| Doble click en el lienzo | Componente fantasma (crear o linkear) |
| Doble click / `Enter` en sistema o contenedor | Bajar de nivel |
| `Alt ↑` | Subir de nivel |
| `Ctrl K` | Paleta de comandos |
| `Shift` + arrastrar | Guías de alineación |
| `Shift L` | Ordenar automáticamente (selección o lienzo) |
| `Supr` / `Shift Supr` | Quitar del lienzo / eliminar del modelo |
| `Ctrl D`, `Ctrl C`, `Ctrl V` | Duplicar, copiar, pegar |
| `Ctrl Z`, `Ctrl Shift Z` | Deshacer, rehacer |
| `Ctrl S` | Guardar |
| `F`, `G`, `R`, `N` | Encuadrar, grilla, reglas, nuevo elemento |
| `Ctrl F` | Buscar en el lienzo (`Enter` / `Shift Enter` para recorrer) |
| `Shift F` | Modo foco |
| `M`, `$` | Minimapa, capa de costos |
| `C` | Comentar (click en el lienzo) |
| `←` `→` `Espacio` `A` `Esc` | Al reproducir un flujo: anterior, siguiente, reproducción automática, salir |
| `Ctrl B`, `Ctrl I` | Explorador, inspector |

## Estructura

```
packages/
  core/          modelo C4 puro: esquemas zod, operaciones con inversa, reglas, diff semántico,
                 análisis, layout automático y exportadores
  format-yaml/   workspace ⇄ archivos YAML, AGENTS.md
  storage/       memoria, IndexedDB, carpetas locales (web) y disco (Node)
  git/           sincronización: git CLI (escritorio/Node) y GitHub API (web)
  icons/         glifos C4 propios + marcas monocromas (simple-icons)
  cli/           CLI `aegon` y el workspace en disco que comparte con el MCP
  mcp/           servidor MCP (stdio) para agentes de IA
apps/
  web/           app React (Vite): lienzo, paneles, stores (zustand)
  desktop/       app de escritorio (Tauri 2 + Rust: disco, git, observador de archivos)
docs/            formato, sincronización, guía para agentes y JSON Schemas
fixtures/        workspace de ejemplo (demo) y generador de workspaces grandes
```

Toda modificación del modelo es una `Op` serializable (`@aegon/core`): la misma API alimenta el
lienzo, el undo/redo, la pestaña Cambios, la CLI y el servidor MCP.

El formato está documentado en [`docs/format.md`](docs/format.md).

## Roadmap

- **Fase 6 · ADRs, docs y ERD** · **Fase 7 · Free-draw**.

## Rendimiento (medido)

Workspace sintético de 5.334 elementos y 5.998 relaciones (`pnpm gen:large`, o "Generar workspace
de escala" en la paleta). `pnpm bench` corre el benchmark en el build de producción y deja los
resultados en `apps/web/bench/results.json`.

- Serializar a YAML: ~200 ms · parsear y validar 11.337 archivos: ~400 ms (Node). En la app,
  ambos corren en un worker.
- Abrir el workspace en el navegador (lectura, parseo y lienzo encuadrado): ~0,8 s · abrir el
  lienzo de 1.000 nodos: ~0,65 s.
- Desplazar y hacer zoom con los 1.000 nodos visibles, en Edge headless (raster por software):
  ~58 fps (antes de la Fase 4: ~37 fps y p95 de 79 ms por cuadro); a zoom de trabajo, ~45 fps.
  En headless el compositor corre por software; con GPU debería rendir mejor (no medido).
- Las mediciones son con la máquina libre: con otra carga pesada en paralelo los tiempos se duplican.
