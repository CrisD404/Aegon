# Aegon

Herramienta para diseñar arquitectura con el modelo **C4** (niveles 1 a 3): un lienzo moderno y
fluido, un modelo único guardado como código (YAML, un archivo por entidad) y pensada desde el
inicio para trabajar con agentes de IA.

Toma como base a IcePanel, suma la flexibilidad de Enterprise Architect y la soltura de draw.io.

## Estado

**Fase 0 · Fundaciones**, **Fase 1 · Lienzo MVP** y **Fase 2 · Escritorio + Git** listas.

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
- **Workspaces:** en el navegador o vinculados a una carpeta local (File System Access API);
  importador de repos de **C4Pro**.
- **Tema claro/oscuro/sistema**, animaciones con soporte de `prefers-reduced-motion`.

## Empezar

Requiere Node 22+ y pnpm.

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
| `Ctrl B`, `Ctrl I` | Explorador, inspector |

## Estructura

```
packages/
  core/          modelo C4 puro: esquemas zod, operaciones con inversa, reglas, diff semántico
  format-yaml/   workspace ⇄ archivos YAML, importador de C4Pro, AGENTS.md
  storage/       memoria, IndexedDB, carpetas locales (web) y disco (Node)
  git/           sincronización: git CLI (escritorio/Node) y GitHub API (web)
  icons/         glifos C4 propios + marcas monocromas (simple-icons)
apps/
  web/           app React (Vite): lienzo, paneles, stores (zustand)
  desktop/       app de escritorio (Tauri 2 + Rust: disco, git, observador de archivos)
docs/            formato y JSON Schemas
fixtures/        repo C4Pro de ejemplo y generador de workspaces grandes
```

Toda modificación del modelo es una `Op` serializable (`@aegon/core`): la misma API alimenta el
lienzo, el undo/redo, la pestaña Cambios y, en la Fase 3, la CLI y el servidor MCP para IA.

El formato está documentado en [`docs/format.md`](docs/format.md).

## Roadmap

- **Fase 3 · IA first:** CLI `aegon` (validate, lint, add, connect, layout, diff, export
  Mermaid/PlantUML/Structurizr), servidor MCP con herramientas 1:1 con las operaciones, análisis
  (huérfanos, ciclos, riesgo), documentación para agentes.
- **Fase 4 · Escala y layout:** ELK en un worker, parseo/diff en worker, minimapa, modo foco.
- **Fase 5 · FinOps y ambientes** · **Fase 6 · ADRs, docs y ERD** · **Fase 7 · Free-draw y flows**.

## Rendimiento (medido)

Workspace sintético de 5.334 elementos y 5.998 relaciones (`pnpm gen:large`, o "Generar workspace
de escala" en la paleta):

- Serializar a YAML: ~260 ms · parsear y validar 11.337 archivos: ~600 ms (Node).
- Crear y abrir el workspace en el navegador: ~0,8 s · abrir el lienzo de 1.000 nodos: ~1,4 s.
- Paneo con 1.000 nodos en Edge headless (raster por software): 15 fps en vista lejana, 34 fps
  acercado; el hilo principal queda ~87 % ocioso, así que con GPU debería ir bastante mejor. El
  objetivo de 60 fps se trabaja en la Fase 4.
