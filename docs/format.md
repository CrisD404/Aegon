# Formato Aegon v2

Un workspace de Aegon es una carpeta (normalmente un repo git) con un archivo YAML por entidad.
Está pensado para revisarse en un diff, mergearse sin conflictos innecesarios y editarse a mano o
con un agente de IA.

```
mi-arquitectura/
├─ aegon.yaml                  # manifiesto (schema: 2)
├─ AGENTS.md                   # guía del formato para agentes (Aegon la genera si no existe)
├─ model/
│  ├─ elements/<id>.yaml       # actor | system | container | component | store | bus | group
│  └─ relations/<id>.yaml
├─ views/<id>.yaml             # lienzos: nivel, scope, posiciones y estilo de relaciones
├─ attachments/                # archivos que Aegon conserva sin interpretar
└─ .aegon/                     # estado local (en .gitignore)
```

Los JSON Schema de cada archivo están en [`docs/schema/`](schema/) (`pnpm gen:schema` los regenera
desde los esquemas zod de `@aegon/core`).

## Principios

- **Modelo único, muchos lienzos.** Los elementos y relaciones existen una sola vez; un lienzo solo
  los ubica. El mismo elemento puede aparecer en varios lienzos.
- **IDs legibles e inmutables.** Se generan del nombre (`Pagos API` → `pagos-api`, `pagos-api-2` si
  ya existe). Renombrar cambia `name`, nunca el `id` ni el nombre del archivo.
- **Jerarquía explícita.** `parent` indica a qué sistema pertenece un container (o a qué container
  un componente). Los grupos (cloud, red, on-prem) son elementos y la membresía va en `groups`.
- **Sin ruido.** No hay `createdAt`/`updatedAt` (git ya guarda la historia), los campos con valor
  por defecto se omiten y las claves siempre salen en el mismo orden.
- **Nada se pierde.** Lo que Aegon no modela todavía va en `extensions` (por ejemplo FinOps
  importado de C4Pro) y los adjuntos se conservan tal cual.

## Elementos

| `kind` | Nivel | `parent` | Campos propios |
|---|---|---|---|
| `actor` | 1–3 | — | `role` |
| `system` | 1 | — | `technology`, `risk` |
| `container` | 2 | `system` | `containerType`, `technology`, `risk` |
| `component` | 3 | `container` | `technology`, `risk` |
| `store` | 1–3 | `system` o `container` | `store: { engine, customEngine, customIcon, type, version, managed }` |
| `bus` | 1–3 | `system` | `bus: { broker, customBroker, customIcon, type, topics }` |
| `group` | 1–3 | `group` | `group: { provider, region, account, cidr }` |

Campos comunes: `name`, `description`, `docs` (Markdown), `groups`, `scope` (`internal` por
defecto, `external`), `status` (`live` por defecto, `planned`, `deprecated`, `retired`), `tags`,
`owner`, `links`, `properties`, `extensions`. `risk` aplica a todo menos actores y grupos.

Cada cosa con su catálogo: `technology` (lenguajes, frameworks, plataformas) solo existe en
`system`, `container` y `component`; una base de datos se describe por su **motor**
(`store.engine`: postgresql, mongodb, redis…), un bus de mensajería por su **broker**
(`bus.broker`: kafka, rabbitmq, sqs, pubsub…) y una relación por sus **protocolos**.

```yaml
# model/elements/eventos-pagos.yaml
id: eventos-pagos
kind: bus
name: Eventos de pagos
parent: payments
bus:
  broker: kafka
  type: stream          # queue | topic | stream | event-bus
  topics: [ pagos.autorizados, pagos.rechazados ]
```

```yaml
# model/elements/payments-db.yaml
id: payments-db
kind: store
name: Payments DB
description: Transacciones y conciliaciones
parent: payments
groups: [ aws-us-east-1 ]
risk: medium
store:
  engine: postgresql
  type: relational
  version: "16"
  managed: aws-rds
tags: [ pci ]
```

## Relaciones

```yaml
# model/relations/payments-api--payments-db.yaml
id: payments-api--payments-db
from: payments-api
to: payments-db
label: Lee y escribe transacciones
protocols: [ jdbc ]
```

- **Una relación por par de elementos** (regla de C4). Si la comunicación va en ambos sentidos se
  usa `direction: bidirectional`; Aegon rechaza una segunda relación entre el mismo par y, si se
  conecta en sentido contrario, convierte la existente en bidireccional.
- `protocols` usa los IDs del catálogo, agrupados así: web y APIs (`https`, `rest`, `grpc`,
  `graphql`, `websocket`, `sse`, `soap`, `webhook`), mensajería (`kafka`, `amqp`, `jms`, `mqtt`,
  `nats`, `pulsar`, `stomp`), acceso a datos (`jdbc`, `sql`, `odbc`, `mongodb-wire`, `resp`, `cql`,
  `bolt`, `s3-api`, `search-api`, `dynamodb-api`), archivos (`sftp`, `ftps`, `smb`, `nfs`),
  identidad (`oauth2`, `oidc`, `saml`, `ldap`, `kerberos`), correo (`smtp`, `imap`) y red (`tcp`,
  `udp`, `ssh`, `dns`, `vpn`). La app sugiere primero los que encajan con el destino (JDBC hacia
  PostgreSQL, Kafka hacia un bus Kafka, HTTPS/REST hacia una API).
- `direction` es `outgoing` por defecto. Conviene conectar los elementos más específicos: en los
  niveles superiores Aegon dibuja la relación **implícita** entre los ancestros que sí están en el
  lienzo (punteada, una sola por par).

## Lienzos

```yaml
# views/payments-containers.yaml
id: payments-containers
name: Payments · Contenedores
level: 2            # 1 contexto · 2 contenedores · 3 componentes
scope: payments     # el system (L2) o container (L3) que se "abre"
nodes:              # esquina superior izquierda, en coordenadas absolutas del lienzo
  payments-api: { x: 0, y: 0 }
  payments-db: { x: 320, y: 0, w: 224, h: 120 }
edges:              # solo las relaciones con estilo distinto del default
  payments-api--payments-db: { shape: step }
```

## Reglas que valida Aegon

- `parent`, `groups`, `from`, `to`, `scope` y las claves de `nodes` apuntan a elementos existentes.
- Padres válidos según la tabla; sin ciclos.
- Los grupos no tienen relaciones y no puede haber dos relaciones entre el mismo par.
- Un lienzo L2 abre un `system` y uno L3 un `container`; cada nivel acepta ciertos tipos.
- Avisos: containers o componentes sin padre, elementos que no están en ningún lienzo.

Un archivo con YAML inválido o que no cumple el esquema se reporta (con su ruta) y se omite: el
resto del workspace abre igual.

## Importar desde C4Pro

`Importar repo de C4Pro…` (o abrir una carpeta de C4Pro) convierte el formato anterior:

| C4Pro | Aegon v2 |
|---|---|
| `elements/*.yaml` con `type: app` | `container` |
| `type: queue` | `bus` |
| `groupKind` | `group.provider` |
| tag `risk:x` | `risk` |
| `displayDescription` / `detailedDescription` | `description` / `docs` |
| `status: future` | `status: planned` |
| `diagrams/*.yaml` | `views/*.yaml` (`layout[]` → `nodes{}`, `scopeElementId` → `scope`) |
| `connections/*.yaml` | `relations/*.yaml` (la forma pasa al estilo del edge de cada lienzo; las repetidas se fusionan y las inversas quedan bidireccionales) |
| costos, FinOps, ambientes | `extensions.c4pro` |
| `attachments/`, `workspace-logo.svg` | `attachments/` sin cambios |

`parent` se infiere de los diagramas L2/L3 y la membresía a grupos de la contención visual en cada
diagrama. Se conservan los IDs originales.
