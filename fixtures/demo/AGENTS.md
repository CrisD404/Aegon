# Banca digital (demo) — guía para agentes

Este repositorio es un workspace de **Aegon**: arquitectura C4 (niveles 1 a 3) guardada como código.
La app de Aegon lee y escribe estos archivos; vos también podés editarlos directamente.

## Estructura

```
aegon.yaml                   # manifiesto del workspace (schema: 2)
model/elements/<id>.yaml     # un archivo por elemento
model/relations/<id>.yaml    # un archivo por relación
views/<id>.yaml              # un archivo por lienzo (diagrama)
attachments/                 # adjuntos que Aegon conserva tal cual
```

- El **modelo** (elementos y relaciones) es único; los **lienzos** solo ubican elementos del modelo.
  Un mismo elemento puede aparecer en varios lienzos: es el mismo objeto, no una copia.
- El nombre de archivo es el `id`. Los IDs son slugs legibles (`payments-api`) e **inmutables**:
  para renombrar, cambiá `name`, nunca el `id`.
- Omití los campos con valor por defecto (`scope: internal`, `status: live`, `direction: outgoing`).

## Elementos (`kind`)

| kind | Nivel | Padre (`parent`) | Campos propios |
|---|---|---|---|
| `actor` | 1–3 | — | `role`, `scope: external` si es externo |
| `system` | 1 | — | `technology`, `risk` |
| `container` | 2 | system | `containerType` (web, mobile, desktop, api, service, worker, function, other), `technology`, `risk` |
| `component` | 3 | container | `technology`, `risk` |
| `store` | 1–3 | system o container | `store: { engine, type, version, managed }` (`engine: other` + `customEngine`), `risk` |
| `bus` | 1–3 | system | `bus: { broker, type, topics }` (kafka, rabbitmq, sqs…; `broker: other` + `customBroker`), `risk` |
| `group` | 1–3 | group | `group: { provider: aws\|gcp\|azure\|onprem\|network\|platform\|other, region, account, cidr }` |

Campos comunes: `name`, `description` (corta), `docs` (Markdown), `groups` (IDs de grupos),
`scope` (internal/external), `status` (planned/live/deprecated/retired), `tags`, `owner`, `links`,
`properties` (clave → texto). `risk` (low/medium/high/critical) va en todo menos actor y group.
`technology` (lenguajes, frameworks, plataformas) va solo en system, container y component: una
base de datos se describe por su motor y un bus de mensajería por su broker.

```yaml
# model/elements/payments-api.yaml
id: payments-api
kind: container
name: Payments API
description: Autoriza y registra pagos
parent: payments
containerType: api
technology: [java, spring-boot]
risk: high
```

## Relaciones

```yaml
# model/relations/payments-api--payments-db.yaml
id: payments-api--payments-db
from: payments-api
to: payments-db
label: Lee y escribe transacciones
protocols: [jdbc]
```

- **Una relación por par de elementos.** Si la comunicación va en ambos sentidos usá
  `direction: bidirectional` en vez de dos relaciones.
- `protocols` usa los IDs del catálogo de Aegon (`https`, `rest`, `grpc`, `graphql`, `kafka`,
  `amqp`, `jdbc`, `sql`, `resp`, `s3-api`, `sftp`, `oidc`…).
- Conectá los elementos más específicos posibles (container → container). Aegon dibuja las
  relaciones implícitas en los niveles superiores (sistema → sistema) automáticamente.

## Lienzos

```yaml
# views/payments-containers.yaml
id: payments-containers
name: Payments · Contenedores
level: 2            # 1 = contexto, 2 = contenedores, 3 = componentes
scope: payments     # system en L2, container en L3; vacío en L1
nodes:              # posición (esquina superior izquierda) de cada elemento ubicado
  payments-api: { x: 0, y: 0 }
  payments-db: { x: 320, y: 0, w: 224, h: 120 }
edges:              # opcional: estilo de las relaciones que se apartan del default
  payments-api--payments-db: { shape: step }
```

## Reglas

- Cada `parent`, `groups`, `from`, `to`, `scope` y clave de `nodes` debe apuntar a un elemento existente.
- Los grupos no tienen relaciones. Un lienzo L2 abre un `system`; uno L3 abre un `container`.
- Los JSON Schema del formato están en la documentación de Aegon (`docs/schema/*.schema.json`).

## Herramientas

- **Servidor MCP** (`@aegon/mcp`): si está conectado, preferilo a editar los YAML a mano. Sus
  herramientas (`add_element`, `connect`, `place`, `create_child_view`…) aplican las reglas de C4,
  generan IDs únicos y escriben solo los archivos que cambian.
- **CLI** (`aegon`): `aegon validate` después de editar a mano; `aegon lint` para huérfanos, ciclos,
  relaciones sin protocolo y hotspots de riesgo; `aegon diff` para ver los cambios del modelo.
