# CLI de Aegon

```bash
node bin/aegon.mjs <comando> [opciones]
```

`bin/aegon.mjs` es un solo archivo dentro de la carpeta de la skill: usá su ruta absoluta. `node bin/aegon.mjs --help` lista los comandos y `node bin/aegon.mjs <comando> --help`, sus opciones: ante la duda, la ayuda manda sobre este documento.

## Opciones globales

| Opción | Qué hace |
|---|---|
| `-w, --workspace <carpeta>` | Carpeta del workspace. Sin ella, la actual o la más cercana hacia arriba con `aegon.yaml`. Va antes o después del comando |
| `--json` | Salida en JSON por la salida estándar |
| `-h, --help` · `-v, --version` | Ayuda y versión |

Los elementos, lienzos y flujos se indican por ID o por nombre exacto (sin distinguir mayúsculas ni acentos). Si un nombre está repetido, el error `[ambiguous]` lista los IDs.

**Códigos de salida:** `0` bien · `1` errores de validación u operación rechazada (`✗ mensaje [código]`) · `2` uso incorrecto (opción desconocida, argumentos de más o de menos).

Los avisos de un comando (`! Tecnología "x" fuera del catálogo…`) y la confirmación de `export -o` salen por la salida de error con código `0`: no son fallas.

## Crear y editar

### `init [carpeta]`

Crea el workspace: `aegon.yaml`, `AGENTS.md` (guía del formato), `.gitignore`, `.gitattributes` y el lienzo `contexto` (L1). Respeta los archivos que ya haya en la carpeta.

- `--name <nombre>`: nombre del workspace (por defecto, el de la carpeta).
- `--demo`: en lugar de uno vacío, el workspace de ejemplo (una banca digital ficticia).
- Si la carpeta ya es un workspace, falla con `[exists]`.

### `add <kind> <nombre>`

Agrega un elemento y responde con su ID. `kind`: `actor`, `system`, `container`, `component`, `store`, `bus`, `group`, `node`, `infra`, `instance` (también acepta `persona`, `sistema`, `contenedor`, `componente`, `db`, `base`, `cola`, `grupo`, `nodo`, `instancia`).

| Opción | Para |
|---|---|
| `--view <lienzo>` | Lo ubica en ese lienzo, en un lugar libre. En un L2, un `container`, `store` o `bus` toma como padre el sistema del lienzo; en un L3, un `component` toma el contenedor |
| `--x <n> --y <n>` | Posición exacta en el lienzo (van juntas) |
| `--parent <id>` | Padre: `container` → `system`, `component` → `container`, `store` → `system` o `container`, `bus` → `system`, `node`/`infra`/`instance` → `node` |
| `--id <id>` | ID explícito (por defecto, el slug del nombre) |
| `-d, --description <texto>` | Descripción corta |
| `-t, --technology <a,b>` | Tecnologías del catálogo |
| `--container-type <tipo>` | `web`, `mobile`, `desktop`, `api`, `service`, `worker`, `function`, `other` |
| `--engine <motor>` | Motor de un `store` |
| `--broker <broker>` · `--topics <a,b>` | Broker y tópicos de un `bus` |
| `--role <rol>` | Rol de un `actor` |
| `--provider <p>` · `--region <r>` | Proveedor y región de un `group` o un `node` |
| `--node-type <tipo>` · `--size` · `--instances <n>` · `--account` | Datos de un `node` |
| `--infra-type <tipo>` | Tipo de un `infra` |
| `--of <id>` · `--replicas <n>` | Qué despliega una `instance` (con `--of` el nombre es opcional) |
| `--addresses <a,b>` · `--resource <id>` | Direcciones e ID de recurso (`node`, `infra`, `instance`) |
| `--env <a,b>` | Ambientes donde existe |
| `--external` | Fuera de la organización (`scope: external`) |
| `--status <estado>` · `--risk <riesgo>` | `planned`, `live`, `deprecated`, `retired` · `low`, `medium`, `high`, `critical` |
| `--group <id>` | Grupo al que pertenece (repetible) |
| `--tags <a,b>` · `--owner <equipo>` | Etiquetas y responsable |

Una opción que no aplica al tipo se ignora con un aviso. Un nombre repetido no falla: genera otro ID (`web-2`).

### `connect <desde> <hasta>`

Crea la relación `desde → hasta` (ID `<desde>--<hasta>`).

- `-l, --label <texto>`, `-d, --description <texto>`, `-p, --protocols <a,b>`, `--ports <443,8080>`, `--bidirectional`, `--status <estado>`.
- Si ya existe en sentido contrario, la vuelve bidireccional. Si ya existe en ese sentido, la completa con lo indicado.
- Sin `-p`, sugiere protocolos según el destino.
- Falla con `[not-found]` si un extremo no existe, `[invalid-endpoint]` si es un grupo y `[self-relation]` si los dos extremos son el mismo.

### `layout <lienzo>`

Ordena el lienzo con el mismo algoritmo que la app (`Shift+L`): capas de arriba hacia abajo, y marcos de grupos y nodos que envuelven a sus miembros. No falla si no hay nada que mover.

- `--ids <a,b,c>`: ordena solo esos elementos (dos o más).
- `--fit-frames`: no mueve nada; ajusta cada nodo o grupo a lo que contiene.

## Revisar

### `validate`

Formato de cada YAML, referencias y reglas C4. Una línea por diagnóstico: `✗ error <archivo>  <mensaje> [código]`.

- `--strict`: los avisos también hacen fallar (código `1`).
- `--info`: suma los informativos, como `[not-in-view]`. Nunca hacen fallar.

### `lint`

Lo mismo que `validate` más el análisis: violaciones de estilo C4, huérfanos (elementos sin relaciones), ciclos de dependencias, relaciones sin protocolo (con sugerencias) y hotspots de riesgo.

- Sale con `1` solo si hay errores. `--strict` hace fallar también por avisos, huérfanos y ciclos.
- `--hotspots <n>`: cuántos hotspots mostrar (10 por defecto).

Con `--json`, los dos traen `ok` y `workspace`. Los diagnósticos (`severity`, `code`, `message`, `file`) vienen en `diagnostics` en `validate` y en `violations` en `lint`, que suma `orphans`, `cycles`, `missingProtocols`, `hotspots` y `summary`.

### `diff [ref]`

Cambios del modelo, entidad por entidad, entre un commit (`HEAD` por defecto) y la carpeta. Necesita que el workspace esté dentro de un repo git (`[not-a-repo]` si no). Sirve para resumir qué cambiaste en un workspace que ya existía.

### `flows`, `flow <id>`, `comments`

Solo lectura.

- `flows [--element <id>]`: lista los flujos.
- `flow <id>`: un flujo como texto numerado, con sus avisos. Con `--json`, además, `steps[].relation`: la relación que usa cada mensaje (si falta, los extremos no están conectados).
- `comments [--open|--resolved] [--view <id>] [--element <id>]`: comentarios de los lienzos con sus respuestas.

## Exportar

### `export <formato>`

| Formato | Salida |
|---|---|
| `mermaid` | Un `flowchart` por lienzo. Con `--view`, solo el diagrama; sin `--view`, un Markdown con un bloque por lienzo |
| `plantuml-c4` | C4-PlantUML, un `@startuml` por lienzo |
| `structurizr` | Structurizr DSL con el modelo completo y una vista por lienzo |
| `json` | El modelo completo. Es la forma de leer un workspace: IDs, relaciones y lienzos |

- `--view <lienzo>`: solo ese lienzo.
- `-o, --output <archivo>`: escribe en un archivo (crea las carpetas) en vez de la salida estándar. La ruta es relativa a la carpeta desde donde corrés el comando, no al workspace.

### `export flow <id> mermaid|text`

Un flujo como `sequenceDiagram` de Mermaid o como texto numerado. Acepta `-o`.

No hay exportación a imagen, SVG, HTML ni PDF desde la CLI: eso se hace en la app.

## Lo que la CLI no hace

| Tarea | Cómo se hace |
|---|---|
| Crear un lienzo (L2, L3, despliegue) | Escribir `views/<id>.yaml` ([forma](modeling.md#lienzos)) |
| Ubicar en un lienzo un elemento que ya existe | Agregar `<id>: { x: 0, y: 0 }` en `nodes` y correr `layout` |
| Modificar un elemento o una relación | Editar su YAML. Para completar una relación también sirve repetir `connect` |
| Renombrar | Cambiar `name` en el YAML. El `id` y el nombre del archivo no se tocan |
| Borrar un elemento | Borrar su archivo, las relaciones que lo nombran (`from` o `to`), sus entradas en `nodes` de cada lienzo y los pasos de flujos que lo usan |
| Definir ambientes | `environments` en `aegon.yaml` ([forma](modeling.md#despliegue)) |
| Crear o editar un flujo | Escribir `flows/<id>.yaml` ([forma](modeling.md#flujos)) |
| Crear comentarios | La app o el servidor MCP |
| Buscar en los catálogos | La lista de [Catálogos](modeling.md#catálogos); lo desconocido se guarda igual, con un aviso |

Después de cualquier edición a mano corré la compuerta (`validate --strict --info` y `lint`). Cuando Aegon vuelve a escribir un archivo lo deja en su forma canónica: los comentarios de YAML y los campos que no conoce no sobreviven.
