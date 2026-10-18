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
├─ flows/<id>.yaml             # flujos: pasos que se reproducen como presentación
├─ comments/<id>.yaml          # comentarios sobre los lienzos
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
- **Nada se pierde.** Lo que Aegon no modela todavía va en `extensions` (por ejemplo datos de
  otras herramientas) y los archivos que no reconoce, como `attachments/`, se conservan tal cual.

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

## Ambientes y costos (FinOps)

Los ambientes y la configuración de costos viven en el manifiesto. El orden de `environments` es el
de la interfaz y el de los costos en cada archivo:

```yaml
# aegon.yaml
environments:
  - { id: dev, name: Desarrollo }
  - { id: qa, name: QA }
  - { id: prod, name: Producción }
finops:
  currency: USD                    # ISO 4217; por defecto USD
  tagKeys: [ cost-center, project ] # etiquetas que se sugieren al cargar costos
  budgets:                         # presupuesto mensual por ambiente
    prod: 9000
```

Cada elemento (salvo los actores) puede indicar dónde está desplegado y cuánto cuesta por mes:

```yaml
# model/elements/cuentas-api.yaml
environments: [ qa, prod ]          # sin el campo: desplegado en todos los ambientes
finops:
  costs:
    qa: { monthly: 90 }
    prod: { monthly: 980, replicas: 4, sku: m6i.large, note: Reservadas a 1 año }
  tags:
    cost-center: CC-1200
```

- `monthly` es el costo mensual estimado en la moneda del workspace; `replicas`, `sku` y `note` son
  opcionales. Un costo cargado para un ambiente donde el elemento no está desplegado no se suma.
- Los totales se acumulan por jerarquía: un sistema suma sus contenedores y componentes. Un grupo
  (cuenta cloud, datacenter) suma a sus miembros y lo que contienen, sin contar dos veces, más su
  costo propio (red, servicios compartidos).
- Las etiquetas de `finops.tags` se heredan: un contenedor sin `cost-center` usa el de su sistema.
- La app muestra los costos en el lienzo (capa de costos, filtrable por ambiente), en el inspector
  y en el panel **Costos** (por ambiente contra presupuesto, por sistema, grupo y etiqueta), y los
  exporta a CSV (una fila por elemento y ambiente).
- Aegon avisa si un elemento usa un ambiente que no está definido en `aegon.yaml`.

## Flujos

Un flujo cuenta cómo viaja un pedido por la arquitectura: quién le habla a quién, en qué orden y
qué pasa si algo falla. La app lo reproduce como una presentación: la cámara enfoca los elementos
de cada paso (y abre el lienzo L2 o L3 que los muestra), la relación del mensaje se anima en su
sentido y el resto queda atenuado.

```yaml
# flows/transferencia.yaml
id: transferencia
name: Transferencia desde la app
description: Desde que el cliente confirma hasta que recibe la notificación.
view: home-banking-containers       # lienzo donde se reproduce
steps:
  - type: message                   # un elemento le habla a otro
    from: app-movil
    to: api-gateway
    title: POST /transferencias
    description: "Body: `{ origen, destino, importe }`"
  - type: process                   # un elemento hace algo por su cuenta
    element: fraude
    title: Evalúa el riesgo
  - type: paths                     # bifurcación
    mode: alternate                 # alternate: uno u otro · parallel: todos a la vez
    title: ¿Se aprueba?
    paths:
      - name: Aprobada
        steps:
          - { type: message, from: pagos-api, to: eventos, title: Publica pagos.autorizados }
      - name: Rechazada
        steps:
          - { type: message, from: pagos-api, to: eventos, title: Publica pagos.rechazados }
  - type: goto                      # continúa en otro flujo (y vuelve)
    flow: notificar-cliente
  - type: note                      # contexto sin elementos
    title: Fin
```

- Un `message` usa la relación entre `from` y `to` (o la indicada en `relation`); si no hay
  relación, se dibuja una flecha temporal. Los pasos se numeran `1, 2, 3`; dentro de un camino,
  `3A.1`, `3B.2`.
- Los caminos tienen un solo nivel (un camino no contiene otra bifurcación).
- Aegon avisa si un paso apunta a un elemento, relación o flujo que no existe.

## Comentarios

Notas, preguntas o advertencias sobre un lienzo, con respuestas. Viajan con el workspace (y con
git), así las ve todo el equipo.

```yaml
# comments/c-mgz1k2ab.yaml
id: c-mgz1k2ab
view: home-banking-containers
element: banking-db                 # anclado: se mueve con el elemento (x, y relativos)
x: 196
y: -14
icon: question                      # message, info, question, warning, idea, check, flag, bug, lock, star
color: violet                       # accent, ok, warn, danger, violet, neutral
title: Costo de la base             # opcional
body: ¿Migramos a Aurora Serverless?
author: Arquitectura
at: 2026-10-15T14:20:00.000Z
resolved: true                      # opcional
replies:
  - { author: Equipo Canales, at: 2026-10-16T09:05:00.000Z, body: Lo evaluamos el próximo trimestre. }
```

## Templates

Un template es un modelo de Aegon reutilizable. Hay dos tipos:

- **Workspace**: un workspace completo (por ejemplo, el de ejemplo "Banca digital"). Sirve para
  crear un workspace nuevo o para inicializar una carpeta vacía.
- **Bloque**: un grupo de elementos con sus relaciones y su layout relativo (un API gateway con su
  proveedor de identidad, un productor y consumidores de Kafka…). Se inserta en un lienzo del nivel
  que corresponde: los IDs se generan de nuevo, los containers y componentes toman como `parent` el
  elemento que abre el lienzo y se copian los lienzos internos del bloque.

Los templates incluidos vienen con la app. Los que guarda el usuario ("Guardar como template…"
sobre una selección o sobre el workspace) quedan en la biblioteca local del navegador o de la app de
escritorio; no forman parte de los archivos del workspace.
