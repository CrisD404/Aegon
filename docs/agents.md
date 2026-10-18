# Aegon para agentes de IA

Aegon está pensado para que un agente (Claude Code, Claude Desktop, Cursor…) diseñe y mantenga
arquitectura C4 junto con vos. Hay tres formas de trabajar, de más a menos guiada:

| Vía | Para qué | Dónde |
|---|---|---|
| **Servidor MCP** | El agente lee y edita el modelo con herramientas que aplican las reglas de C4 | `packages/mcp` |
| **CLI `aegon`** | Validar, analizar, editar y exportar desde la terminal o un script (CI, hooks) | `packages/cli` |
| **YAML a mano** | Cualquier editor o agente sin herramientas; `AGENTS.md` en cada workspace explica el formato | [`format.md`](format.md) |

Las tres escriben los mismos archivos. Si la **app de escritorio** tiene abierta la carpeta, cada
cambio aparece en vivo en el lienzo y en la pestaña Cambios (como un cambio sin commitear que se
combina con tu borrador, ver [`sync.md`](sync.md)).

Requisitos: Node 24 (ejecuta TypeScript sin compilar) y `pnpm install` en el repo de Aegon.

## Servidor MCP

Servidor stdio con herramientas 1:1 con las operaciones del modelo (`Op` de `@aegon/core`). Antes
de cada herramienta vuelve a leer la carpeta (ve lo que cambiaste en la app, un editor o un
`git checkout`) y cada escritura pasa por `applyOp`, que valida, y se guarda con `planWrite`: solo
se escriben los archivos que cambiaron.

```bash
node C:/Projects/Aegon/packages/mcp/src/main.ts --workspace C:/ruta/a/mi-arquitectura
```

Sin `--workspace` usa la variable `AEGON_WORKSPACE` o la carpeta actual (o la más cercana hacia
arriba que tenga `aegon.yaml`).

### Conectarlo a Claude Code

Para todos tus proyectos (scope de usuario), apuntando a un workspace fijo:

```bash
claude mcp add aegon --scope user -- node C:/Projects/Aegon/packages/mcp/src/main.ts --workspace C:/ruta/a/mi-arquitectura
```

O por proyecto, en un `.mcp.json` en la raíz del repo de arquitectura (sin `--workspace` toma la
carpeta donde corre Claude Code):

```json
{
  "mcpServers": {
    "aegon": {
      "command": "node",
      "args": ["C:/Projects/Aegon/packages/mcp/src/main.ts"]
    }
  }
}
```

Verificá la conexión con `claude mcp list` (tiene que decir `aegon … ✓ Connected`) o con `/mcp`
dentro de Claude Code. Las herramientas aparecen como `mcp__aegon__<nombre>`; para no tener que
aprobar cada una, sumá `"mcp__aegon"` a `permissions.allow` en `.claude/settings.json`.

En Claude Desktop, Cursor u otro cliente MCP la configuración es la misma (`command: node`,
`args: [ruta a main.ts, --workspace, carpeta]`).

### Herramientas

| Herramienta | Qué hace |
|---|---|
| `get_workspace` | Nombre, carpeta, formato, conteos y lienzos. El punto de partida |
| `list_elements` | Elementos (resumen), filtrables por `kind`, `parent`, `view` o texto |
| `get_element` | Un elemento con ancestros, hijos, relaciones, lienzos donde aparece y su lienzo de detalle |
| `list_relations` / `get_relation` | Relaciones; filtro `withoutProtocols` para las que no declaran protocolo |
| `list_views` / `get_view` | Lienzos; `get_view` trae nodos con posición, relaciones visibles (incluidas las implícitas) y qué se puede ubicar |
| `search_catalog` | IDs válidos de tecnologías, motores, brokers, protocolos (ordenados según el destino) y proveedores |
| `add_element` | Crea un elemento; con `view` lo ubica en un lugar libre y en un L2/L3 hereda el padre |
| `update_element` / `remove_element` | `patch` con los campos a cambiar (`null` borra); eliminar es en cascada |
| `connect` | Relación `from → to` respetando una por par (al revés la vuelve bidireccional) |
| `update_relation` / `remove_relation` | Ídem para relaciones |
| `create_view` / `update_view` / `remove_view` | Lienzos L1 |
| `create_child_view` | Abre (o crea, con hijos y vecinos ya ubicados) el L2 de un sistema o el L3 de un contenedor |
| `place` / `unplace` | Ubica o quita elementos existentes de un lienzo |
| `layout_view` | Orden automático por capas (lo mismo que `Shift+L` en la app) |
| `set_edge_style` | Forma de una relación (curved, straight, step) u ocultarla en un lienzo |
| `update_workspace` | Nombre, descripción, organización, lienzo por defecto |
| `list_flows` / `get_flow` | Flujos (recorridos paso a paso); `get_flow` trae el YAML del flujo, los pasos numerados como en la app (`1`, `5A.2`) con su título visible y la relación que dibuja cada mensaje, el texto legible y sus avisos |
| `create_flow` | Crea un flujo, vacío o con sus pasos; `view` es el lienzo donde arranca la presentación |
| `add_flow_step` | Agrega un paso `message`, `process`, `note`, `goto` o `paths` (bifurcación) al final o en `position`; con `path: "5A"` lo agrega dentro de ese camino |
| `update_flow` / `delete_flow` | Nombre, descripción, lienzo o la lista completa de pasos (para reordenar o quitar); borrar avisa qué `goto` quedan rotos |
| `list_comments` | Comentarios de los lienzos con sus respuestas, en orden cronológico; filtros `view`, `element` y `status` (`open`, `resolved`) |
| `add_comment` | Comentario en un lienzo; con `element` queda anclado (sin `view`, va al lienzo donde el elemento está con sus hermanos) y sin `x`/`y` se ubica solo |
| `reply_comment` / `resolve_comment` / `delete_comment` | Responder, resolver (o reabrir con `resolved: false`) y borrar |
| `validate` | Sintaxis, esquema, referencias y reglas C4 (`ok: false` si hay errores) |
| `analyze` | Huérfanos, ciclos de dependencias, violaciones C4, relaciones sin protocolo y hotspots de riesgo |
| `export` | Mermaid, C4-PlantUML, Structurizr DSL o JSON |

Las herramientas aceptan IDs o nombres exactos (`"Home Banking"` → `home-banking`). Los errores
vuelven como resultado con `isError` y un código entre corchetes (`[invalid-parent]`,
`[duplicate-relation]`, `[not-found]`, `[invalid-step]`…) para que el agente corrija y reintente.
Los comentarios y respuestas se firman con `author` (por defecto `"Agente de IA"`).

### Prompts de ejemplo

- *"Agregá al sistema Pagos un contenedor 'Conciliador' (worker en Go) que lea de Pagos DB por JDBC
  y publique en el bus de eventos por Kafka. Ubicalo en su lienzo y validá."*
- *"Leé `docker-compose.yml` y `src/` y modelá los contenedores de este repo dentro del sistema
  Checkout, con sus bases de datos y las relaciones entre ellos. Usá protocolos del catálogo."*
- *"Corré analyze y arreglá las relaciones sin protocolo usando las sugerencias; después decime qué
  hotspots de riesgo quedan."*
- *"Abrí el L3 de Pagos API y agregá los componentes que encuentres en `services/payments/`."*
- *"Exportá el lienzo de contenedores a Mermaid y pegalo en el README."*
- *"Documentá como flujo qué pasa cuando un cliente consulta su saldo desde la app, con un camino
  si el saldo está en caché y otro si hay que ir al core bancario."*
- *"Revisá los comentarios abiertos del lienzo de contenedores: respondé los que puedas contestar
  mirando el código y resolvé los que ya estén atendidos."*

### Ejemplo: crear un contenedor y conectarlo

Con el servidor apuntando a una copia de [`fixtures/demo`](../fixtures/demo), este pedido:

> Agregá al sistema Home Banking un contenedor nuevo llamado "Conciliador": un worker en Java con
> Spring Boot que concilia los movimientos cada noche. Ubicalo en el lienzo de contenedores de Home
> Banking y conectalo a Banking DB (lee y escribe movimientos, por JDBC) y al bus Eventos de pagos
> (publica las conciliaciones, por Kafka). Al final validá el workspace.

se resuelve con estas cuatro llamadas. Las respuestas son reales (recortadas), obtenidas con el
cliente MCP oficial (`@modelcontextprotocol/client`) contra el binario por stdio:

```jsonc
// add_element {"kind":"container","name":"Conciliador","view":"home-banking-containers",
//              "technology":["java","spring-boot"],"containerType":"worker",
//              "description":"Concilia los movimientos cada noche."}
{
  "ok": true,
  "summary": "Contenedor \"Conciliador\" agregado (conciliador), ubicado en home-banking-containers (1080, -300)",
  "id": "conciliador",
  "written": ["model/elements/conciliador.yaml", "views/home-banking-containers.yaml"],
  "element": { "id": "conciliador", "name": "Conciliador", "parent": "home-banking", "technology": ["java", "spring-boot"], "kind": "container", "containerType": "worker" }
}

// connect {"from":"conciliador","to":"Banking DB","label":"Lee y escribe movimientos","protocols":["jdbc"]}
{ "ok": true, "summary": "Relación creada: Conciliador → Banking DB (conciliador--banking-db)", "result": "created", "written": ["model/relations/conciliador--banking-db.yaml"] }

// connect {"from":"conciliador","to":"Eventos de pagos","label":"Publica las conciliaciones","protocols":["kafka"]}
{ "ok": true, "summary": "Relación creada: Conciliador → Eventos de pagos (conciliador--eventos)", "result": "created", "written": ["model/relations/conciliador--eventos.yaml"] }

// validate {}
{ "ok": true, "errors": 0, "warnings": 0, "diagnostics": [] }
```

Fijate en tres detalles: el contenedor hereda `parent: home-banking` porque se creó en el lienzo L2
de ese sistema; los extremos se pueden pasar por nombre (`"Banking DB"` se resuelve a `banking-db`);
y solo se escriben los archivos que cambiaron. En disco queda:

```yaml
# model/elements/conciliador.yaml
id: conciliador
kind: container
name: Conciliador
description: Concilia los movimientos cada noche.
parent: home-banking
technology: [ java, spring-boot ]
containerType: worker
```

### Ejemplo: documentar un flujo y dejar un comentario

Un flujo cuenta un recorrido paso a paso (formato en [`format.md`](format.md#flujos)); la app lo
reproduce como presentación. Este pedido, sobre otra copia del demo:

> Documentá como flujo la consulta de saldo desde la app móvil: el cliente abre la app, la app
> pide el saldo al API Gateway y, si está en la caché, se lee de ahí; si no, Cuentas API lo
> consulta al core bancario. Dejá una pregunta sobre el TTL de la caché.

se resuelve así (respuestas reales del binario por stdio, recortadas):

```jsonc
// create_flow {"name":"Consulta de saldo","view":"home-banking-containers",
//              "steps":[{"type":"message","from":"Cliente","to":"App móvil","title":"Abre la app"}]}
{ "ok": true, "summary": "Flujo \"Consulta de saldo\" creado (consulta-de-saldo)", "id": "consulta-de-saldo", "warnings": [], "written": ["flows/consulta-de-saldo.yaml"] }

// add_flow_step {"id":"consulta-de-saldo","type":"message","from":"app-movil","to":"api-gateway","title":"GET /cuentas/{id}/saldo"}
{ "ok": true, "summary": "Paso 2 agregado a \"Consulta de saldo\"", "step": "2",
  "added": { "n": "2", "type": "message", "title": "GET /cuentas/{id}/saldo", "from": "app-movil", "to": "api-gateway", "relation": "app-movil--api-gateway" } }

// add_flow_step {"id":"consulta-de-saldo","type":"paths","title":"¿Está en caché?","paths":["Sí","No"]}
{ "ok": true, "summary": "Paso 3 agregado a \"Consulta de saldo\"", "step": "3" }

// add_flow_step {"id":"consulta-de-saldo","path":"3A","type":"message","from":"api-gateway","to":"cache","title":"Lee el saldo"}
{ "ok": true, "summary": "Paso 3A.1 agregado a \"Consulta de saldo\"", "step": "3A.1" }

// add_flow_step {"id":"consulta-de-saldo","path":"3B",…"from":"api-gateway","to":"cuentas-api","title":"Consulta el saldo"}
// add_flow_step {"id":"consulta-de-saldo","path":"3B",…"from":"cuentas-api","to":"core-bancario","title":"Saldo en línea"}
{ "ok": true, "summary": "Paso 3B.2 agregado a \"Consulta de saldo\"", "step": "3B.2" }

// add_comment {"element":"Cache","icon":"question","body":"¿Cuánto dura el saldo en caché? Hoy no hay TTL documentado."}
{ "ok": true, "summary": "Comentario agregado en home-banking-containers, anclado a cache (c-mvdd8a2wh0rn)",
  "written": ["comments/c-mvdd8a2wh0rn.yaml"],
  "comment": { "view": "home-banking-containers", "element": "cache", "elementName": "Caché de sesiones", "resolved": false, "author": "Agente de IA", "replies": [] } }
```

`get_flow` devuelve, además del YAML y los pasos numerados, el texto que se ve en la app:

```text
Consulta de saldo

1. Cliente → App móvil: Abre la app
2. App móvil → API Gateway: GET /cuentas/{id}/saldo
3. ¿Está en caché? (uno de estos caminos)
   A) Sí
      3A.1. API Gateway → Caché de sesiones: Lee el saldo
   B) No
      3B.1. API Gateway → Cuentas API: Consulta el saldo
      3B.2. Cuentas API → Core bancario: Saldo en línea
```

Cada mensaje usa la relación que ya une a sus extremos (`relation` en la respuesta); si no hay
ninguna, el paso se guarda igual con un aviso en `warnings` (la app dibuja una flecha temporal), así
que conviene conectar los elementos antes. El comentario sin `view` cayó en el lienzo donde la
caché está con sus hermanos y, sin `x`/`y`, en la esquina del nodo.

**Qué está verificado.** El test `stdio` de [`packages/mcp/src/mcp.test.ts`](../packages/mcp/src/mcp.test.ts)
lanza el binario real (`node packages/mcp/src/main.ts --workspace <carpeta>`) con el cliente MCP
oficial, crea un contenedor en un lienzo L2, lo conecta y comprueba el resultado en los YAML. Otro
test hace lo mismo sobre una copia del demo y valida; los tests `flujos` y `comentarios` recorren
las herramientas de flujos y comentarios sobre el modelo del demo (que trae el flujo
`transferencia` y dos comentarios). Además, `claude mcp list` detecta el servidor declarado en un
`.mcp.json`. **Pendiente:** una corrida de punta a punta con Claude Code usando el modelo (requiere
una sesión iniciada en la CLI `claude`).

## CLI `aegon`

```bash
node C:/Projects/Aegon/packages/cli/src/main.ts <comando>
```

Desde el repo de Aegon también: `pnpm aegon <comando>` (las rutas relativas son respecto de la
raíz del repo). Sin `-w/--workspace` usa la carpeta actual o la más cercana hacia arriba con
`aegon.yaml`. Con `--json`, cualquier comando devuelve JSON (útil para scripts y agentes sin MCP).
Los elementos y lienzos se indican por ID o por nombre.

| Comando | Qué hace |
|---|---|
| `aegon init [carpeta] [--name] [--demo]` | Crea un workspace vacío o el de ejemplo (respeta los archivos que ya haya en la carpeta) |
| `aegon validate [--strict] [--info]` | Valida formato, referencias y reglas C4. Sale con 1 si hay errores (o avisos con `--strict`) |
| `aegon lint [--strict] [--hotspots n]` | Validación + análisis: huérfanos, ciclos, violaciones C4, relaciones sin protocolo, hotspots |
| `aegon add <kind> <nombre> [--parent] [--view] …` | Agrega un elemento (`aegon add --help` lista todas las opciones) |
| `aegon connect <desde> <hasta> [--label] [--protocols a,b]` | Conecta dos elementos (una relación por par) |
| `aegon layout <lienzo> [--ids a,b]` | Ordena un lienzo automáticamente |
| `aegon diff [ref]` | Cambios semánticos del modelo respecto de un commit (`HEAD` por defecto) |
| `aegon export mermaid\|plantuml-c4\|structurizr\|json [--view] [-o archivo]` | Exporta |
| `aegon flows [--element id]` | Lista los flujos (pasos y lienzo de cada uno) |
| `aegon flow <id>` | Un flujo con sus pasos numerados (`1`, `5A.2`) y sus avisos; con `--json`, además el YAML y la relación de cada mensaje |
| `aegon export flow <id> mermaid\|text [-o archivo]` | Un flujo como diagrama de secuencia de Mermaid o como texto numerado |
| `aegon comments [--open\|--resolved] [--view id] [--element id]` | Comentarios de los lienzos con sus respuestas |

```bash
aegon add container "Conciliador" --view home-banking-containers -t java,spring-boot --container-type worker
aegon connect conciliador banking-db -l "Lee y escribe movimientos" -p jdbc
aegon lint
aegon diff
aegon export mermaid --view home-banking-containers -o docs/contenedores.md
aegon flow transferencia
aegon export flow transferencia mermaid -o docs/transferencia.mmd
aegon comments --open
```

La CLI lee flujos y comentarios; para crearlos o editarlos usá la app o el servidor MCP.

Códigos de salida: `0` ok, `1` errores de validación o una operación rechazada, `2` uso incorrecto.
`aegon validate --strict` en CI (o en un hook de pre-commit) mantiene el modelo sano.

## Exportadores

| Formato | Salida |
|---|---|
| `mermaid` | `flowchart` por lienzo: marco del sistema/contenedor abierto, grupos como `subgraph`, implícitas punteadas, externos en gris. Sin `--view`, un Markdown con un bloque por lienzo |
| `plantuml-c4` | C4-PlantUML (`!include <C4/C4_Component>`), un `@startuml` por lienzo, `*_Boundary`, `*Db`, `*Queue`, `_Ext` |
| `structurizr` | Structurizr DSL con el modelo jerárquico, grupos, relaciones explícitas y una vista por lienzo |
| `json` | El modelo completo con listas ordenadas por ID |
| `flow … mermaid` | Un flujo como `sequenceDiagram`: un participante por elemento, mensajes numerados, `process` como nota y las bifurcaciones como `alt`/`else` (alternativas) o `par`/`and` (paralelas) |
| `flow … text` | Un flujo como texto numerado, para pegar en un ticket o junto a una imagen del diagrama |
