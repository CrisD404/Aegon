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
más **flujos**, **comentarios**, **varios niveles en un lienzo**, **salud del modelo**, los
**modos de trabajo** (Diseñar, Desplegar, Simular y Costos) y la **skill para agentes**.

Simulador de carga (ver [`docs/format.md`](docs/format.md#simulador-de-carga)):

- **Modo Simular:** elegís cuánto tráfico entra (pedidos por segundo) y cada parte muestra su uso:
  carga sobre capacidad. Lo que satura queda en rojo y lo que lo llama en línea, marcado como
  frenado; lo que pasa por un bus no frena a nadie, se acumula.
- **Veredicto:** hasta cuánto aguanta y qué cede primero ("Aguanta hasta 300 · primero se atrasa
  Notificaciones"), distinguiendo lo que se atrasa de lo que falla.
- **Sin cargar nada:** el recorrido sale de las relaciones del modelo y las réplicas, del
  despliegue del ambiente (o de los costos). La capacidad por réplica se supone por tipo y queda
  marcada como supuesto; el panel **Carga** deja escribir la real donde se la conoce.
- **Es un modelo, no una medición:** sirve para ver órdenes de magnitud y encontrar el cuello de
  botella; no reemplaza una prueba de carga. El mismo cálculo está en `@aegon/core`
  (`simulateLoad`) para la CLI y los agentes.

Modos de trabajo y despliegue (ver [`docs/format.md`](docs/format.md#despliegue)):

- **Modos:** la barra superior cambia entre **Diseñar** (el modelo: contexto, contenedores y
  componentes), **Desplegar** (dónde corre cada parte, por ambiente), **Simular** (cuánto tráfico
  aguanta) y **Costos**. Es el mismo modelo; cada modo trae sus controles al lienzo y vuelve al
  lienzo donde estabas.
- **Ambientes a la vista:** en Desplegar, la barra del lienzo muestra los ambientes del workspace.
  Uno con despliegue se abre con un click; uno sin despliegue se crea **copiando** el actual (los
  nodos, la infraestructura y las instancias se duplican para el ambiente nuevo con la misma
  disposición; direcciones y cuenta no se copian) o **vacío**.
- **Lo que falta desplegar:** la barra cuenta los contenedores, bases y buses sin instancia en ese
  ambiente. Se arrastran a un nodo, o **Desplegar todo** crea una instancia de cada uno (dentro del
  nodo seleccionado, o de un nodo nuevo que después se renombra).
- **Réplica única:** Salud avisa cuando algo propio de riesgo alto o crítico corre en producción
  con una sola réplica.
- **Quién lleva la IP:** un servidor, una VM o una red es un **nodo** y lleva la dirección. Lo que
  corre adentro se crea con doble click dentro del nodo (**Servicio o aplicación**, **Base de
  datos**): nace desplegado, como instancia con sus propios puertos. Escribir `active directory`,
  `dns` o `nginx` lo propone desde el catálogo. Las flechas con protocolo y puerto son lo que hay
  que abrir en el firewall.
- **Sistemas puestos directo:** un sistema ubicado en un despliegue sin instancia no lleva IP. Al
  seleccionarlo, el inspector pregunta qué es y lo convierte en un click: **un servidor o equipo**
  (pasa a ser un nodo, con el mismo nombre, relaciones y lugar) o **software que corre acá** (queda
  su instancia). Un sistema con contenedores se **detalla** en una instancia por contenedor.
- **Los marcos crecen:** lo que se crea dentro de un nodo queda adentro sin pisar lo que ya había, y
  el nodo (y los que lo contienen) se agranda para envolverlo. Copiar un nodo copia lo que contiene.
- **Cada protocolo con su puerto:** una relación puede llevar varios protocolos y cada uno sus
  puertos (DNS 53, NTP 123, LDAP 389 y 636). En el inspector es un renglón por protocolo con el
  puerto al lado, y la flecha los muestra uno debajo del otro, sin mezclar. En un despliegue el
  protocolo entra ya con su puerto habitual; lo cargado antes (protocolos por un lado, puertos por
  otro) se empareja solo cuando el puerto es el habitual de ese protocolo.
- **Qué es nuevo y qué cambia:** cada elemento y cada relación tiene un **estado**: existente (sin
  marca), **nuevo**, **se modifica**, **se da de baja** o retirado. Se elige bajo el nombre en el
  inspector o con click derecho → Estado (también con varios seleccionados). En el lienzo se ve
  como un color y una etiqueta, igual en nodos, marcos y flechas, y vale en todos los lienzos, no
  solo en despliegue. Lo que está dentro de un servidor nuevo es nuevo sin marcarlo, y una flecha
  hacia algo nuevo también: es la regla de firewall que hay que pedir. La leyenda del lienzo
  (abajo a la izquierda) cuenta cuánto hay de cada estado y, con un click, deja a la vista solo eso.

Un lienzo, varios niveles (ver [`docs/format.md`](docs/format.md#lienzos)):

- **Abrir en el lugar:** doble click (o `Enter`) en un sistema lo convierte en un marco con sus
  contenedores adentro, en el mismo lienzo; lo mismo en un contenedor con sus componentes. Lo que lo
  rodea se corre para hacerle lugar y, al cerrarlo, todo vuelve a donde estaba. Con `Alt` se abre en
  un lienzo aparte, como antes.
- **Profundidad:** el control arriba a la derecha lleva todo el lienzo a **Contexto**,
  **Contenedores** o **Componentes** de una vez.
- **Reglas C4 como avisos:** un lienzo acepta elementos de cualquier nivel. Quien quiera un lienzo
  por nivel activa **C4 estricto** en el panel Salud y la mezcla aparece como aviso.
- **Salud del modelo:** el panel **Salud** muestra lo que antes solo salía por `aegon lint`
  (errores, avisos, ciclos de dependencias, riesgo concentrado, elementos sin relaciones y
  relaciones sin protocolo); cada hallazgo lleva al lienzo. Si hay errores o avisos, la barra
  superior lo indica.
- **Despliegue a la vista:** la pestaña Lienzos tiene su botón **Despliegue** y el workspace de
  ejemplo trae el despliegue de producción de Home Banking.

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
- **Ida y vuelta, cada una con lo suyo:** una relación bidireccional lleva los protocolos y puertos
  de cada sentido por separado. El lienzo dibuja una sola línea con una etiqueta por sentido, cerca
  de la punta a la que apunta y con una flechita que dice hacia dónde va.
- **Reglas C4:** una sola relación por par (conectar al revés la vuelve bidireccional), catálogos
  separados de tecnologías, motores de BD, brokers de mensajería y protocolos (estos últimos
  sugeridos según el destino).
- **Componente fantasma:** doble click en el lienzo, escribís un nombre y elegís crear o **linkear
  un elemento existente** del modelo. Detecta motores de BD (`post` → PostgreSQL) y proveedores
  (`aws` → grupo AWS). Soltar una conexión en el vacío también abre el fantasma.
- **Niveles:** doble click en un sistema abre sus contenedores y en un contenedor sus componentes,
  en el lugar; `Alt` + doble click los abre en su lienzo de detalle (L2 o L3), con breadcrumbs y
  `Alt ↑` para subir.
- **Explorador** virtualizado: modelo (filtros L1/L2/L3), grupos por proveedor, lienzos y
  dependencias del elemento seleccionado; arrastrar al lienzo ubica el elemento.
- **Inspector** por tipo: actor (interno/externo, rol), base de datos (motor del catálogo u "otro"
  con ícono propio), grupo (proveedor, región, CIDR), tecnología con autocompletado, riesgo,
  estado, tags, links, documentación, propiedades.
- **Grilla, reglas y guías:** grilla de puntos/líneas, snap, reglas y `Shift+L` para ordenar
  automáticamente (por capas). **Shift al arrastrar** (uno o varios nodos) muestra las guías: el
  nodo se alinea con los demás, borde con borde y centro con centro, y se acomoda a la **misma
  distancia** que ya hay entre sus vecinos de fila o columna (o centrado entre dos), con la medida
  a la vista. Queda a píxeles enteros, exactamente donde se lo vio al soltar. Las mismas guías
  aparecen **al redimensionar con Shift**: el borde que se arrastra se alinea con el de otro, iguala
  el ancho o el alto de uno de su clase, o repite la distancia entre sus vecinos.
- **Selección por recuadro:** arrastrar sobre el fondo selecciona solo lo que queda entero adentro.
- **Flechas acomodadas a mano:** el trazo es automático, pero una flecha seleccionada muestra
  puntos; arrastrar uno la lleva por otro lado (para que no pase por debajo de algo). Se pueden
  sumar varios y un doble click quita un punto. Las **puntas** también se arrastran: se deslizan
  por el borde del componente para elegir de qué lado toca y a qué altura (se enganchan al medio
  del lado y en línea con el tramo que sigue); doble click devuelve esa punta al automático.
  Soltada **sobre otro componente**, la flecha se muda a ese: la relación cambia de extremo y
  conserva su etiqueta, protocolos y puertos. Lo acomodado
  es de ese lienzo (`edges.<relación>`: `points`, `from`, `to`), el recorrido acompaña a sus
  extremos cuando se mueven juntos, y «Volver al trazo automático» o reordenar con `Shift+L` lo
  descartan.
- **Etiquetas que se mueven:** la etiqueta de una flecha se arrastra a lo largo de su trazo, para
  que no quede detrás de otra ni se confunda con la de al lado (un click sin mover sigue
  seleccionando la flecha). Queda guardada en ese lienzo (`labelAt`), las etiquetas automáticas la
  esquivan y un doble click la devuelve a su lugar. Vale para todas: las de relaciones agrupadas y
  las dos de una relación bidireccional, cada una por separado.
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

### Skill para agentes

[`skills/aegon`](skills/aegon) es una Agent Skill (Claude Code, Codex, Cursor…): una carpeta
autocontenida con la CLI en un solo archivo, que corre con `node` sin instalar el repo. El agente
arma el workspace desde una descripción o leyendo tu repositorio, lo ordena y no lo da por
terminado hasta que `validate` y `lint` pasan.

```bash
git clone https://github.com/CrisD404/Aegon
```

```bash
cp -r Aegon/skills/aegon ~/.claude/skills/aegon
```

Después pedile "documentá la arquitectura de este repo con Aegon". El resultado es una carpeta que
abrís en <https://crisd404.github.io/Aegon/> con **Abrir carpeta** (Chrome o Edge) o en la app de
escritorio; para una vista rápida, el agente exporta a Mermaid. Detalles en
[`docs/agents.md`](docs/agents.md#skill). `pnpm build:skill` regenera la CLI empaquetada.

| Script | Qué hace |
|---|---|
| `pnpm dev` | App en modo desarrollo (puerto 5180) |
| `pnpm build` | Typecheck de todos los paquetes + build de la app |
| `pnpm test` | Tests unitarios (vitest) |
| `pnpm test:e2e` | Tests e2e (Playwright). Con `PLAYWRIGHT_CHANNEL=msedge` usa el Edge instalado |
| `pnpm desktop:dev` / `pnpm desktop:build` | App de escritorio en desarrollo / ejecutable de release |
| `pnpm test:desktop` | E2E de la app de escritorio real (lanza el `.exe` y se conecta a WebView2) |
| `pnpm gen:schema` | Regenera los JSON Schema en `docs/schema/` |
| `pnpm build:skill` | Regenera la CLI empaquetada de la skill (`skills/aegon/bin/aegon.mjs`) |
| `pnpm gen:large` | Genera un workspace de ~5k elementos en `fixtures/large/` |
| `pnpm aegon <comando>` | CLI de Aegon (`validate`, `lint`, `add`, `connect`, `layout`, `diff`, `export`) |
| `pnpm mcp -- --workspace <carpeta>` | Servidor MCP por stdio (para probarlo a mano; los clientes lo lanzan solos) |

## Atajos

| Atajo | Acción |
|---|---|
| Doble click en el lienzo | Componente fantasma (crear o linkear) |
| Doble click / `Enter` en sistema o contenedor | Abrirlo o cerrarlo en el lugar |
| `Alt` + doble click / `Alt Enter` | Abrirlo en un lienzo aparte (L2 o L3) |
| `Alt ↑` | Subir de nivel |
| `Ctrl K` | Paleta de comandos |
| `Shift` + arrastrar o redimensionar | Guías: alinear, igualar tamaños y repetir la distancia entre vecinos |
| Arrastrar un punto de una flecha seleccionada | Llevar la flecha por otro lado, o elegir de qué lado toca (las puntas). Doble click lo quita |
| `Shift L` | Ordenar automáticamente (selección o lienzo) |
| `Supr` | Eliminar la selección. Lo que también está en otros lienzos solo sale de este, y el aviso lo dice |
| `Shift Supr` | Eliminar del modelo, esté donde esté |
| `F2` / `Enter` / doble click en el nombre | Renombrar (`Esc` cancela) |
| `Ctrl` o `Shift` + click | Sumar o quitar de la selección |
| `Ctrl D`, `Ctrl C`, `Ctrl V` | Duplicar, copiar, pegar (un nodo va con lo que contiene) |
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
skills/
  aegon/         Agent Skill: guía de trabajo, referencias y la CLI en un archivo
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
