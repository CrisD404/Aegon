# Formato Aegon v2

Un workspace de Aegon es una carpeta (normalmente un repo git) con un archivo YAML por entidad.
Está pensado para revisarse en un diff, mergearse sin conflictos innecesarios y editarse a mano o
con un agente de IA.

```
mi-arquitectura/
├─ aegon.yaml                  # manifiesto (schema: 2)
├─ AGENTS.md                   # guía del formato para agentes (Aegon la genera si no existe)
├─ model/
│  ├─ elements/<id>.yaml       # actor | system | container | component | store | bus | group | node | infra | instance
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
| `node` | despliegue | `node` | `node: { type, provider, region, account, size, instances }`, `technology`, `addresses`, `resource`, `risk` |
| `infra` | despliegue | `node` | `infra: { type }`, `technology`, `addresses`, `resource`, `risk` |
| `instance` | despliegue | `node` | `instance: { of, replicas }`, `addresses`, `resource` |

Campos comunes: `name`, `description`, `docs` (Markdown), `groups`, `scope` (`internal` por
defecto, `external`), `status`, `tags`, `owner`, `links`, `properties`, `extensions`. `risk` aplica
a todo menos actores y grupos.

`status` dice qué pasa con el elemento (o la relación) y es lo que el lienzo pinta como nuevo o
modificado:

| `status` | Qué significa | En el lienzo |
| --- | --- | --- |
| `live` (por defecto) | Ya existe y no cambia | Sin marca |
| `planned` | Nuevo: todavía no existe | Verde, etiqueta «Nuevo» |
| `changing` | Ya existe y se modifica | Ámbar, etiqueta «Se modifica» |
| `deprecated` | Existe y se da de baja | Rojo, etiqueta «Baja» |
| `retired` | Ya no está | Gris, nombre tachado |

Lo que no tiene `status` lo toma de su contexto: lo que está dentro (`parent`) de algo `planned`,
`deprecated` o `retired` se ve igual; una instancia se ve como lo que despliega; y una relación
toma el estado de un extremo que todavía no existe o deja de existir. `changing` no se hereda:
cambia el servidor, no lo que corre adentro. Marcar el elemento lo saca de esa regla.

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
- **Cada protocolo con sus puertos.** Una entrada de `protocols` es el ID (`https`) o, para decir
  por qué puertos de destino va, el ID con sus `ports`. Así una relación con varios servicios no
  mezcla nada:

  ```yaml
  protocols:
    - id: dns
      ports: [ 53 ]
    - id: ldap
      ports: [ 389, 636 ]
    - https          # sin puerto
  ```

  La flecha muestra un renglón por cada uno (`[DNS :53]`, `[LDAP :389, :636]`) y los que no tienen
  puerto van juntos (`[REST/JSON, HTTPS]`).
- En una relación bidireccional, `protocols` y `label` son los de la **ida** (de `from` hacia `to`) y
  el bloque `back` lleva los de la **vuelta** (de `to` hacia `from`), con los puertos por los que
  escucha `from`:

  ```yaml
  from: servidor-de-archivos
  to: controlador-de-dominio
  label: Autentica
  protocols:
    - id: ldap
      ports: [ 389 ]
  direction: bidirectional
  back:
    label: Replica perfiles
    protocols:
      - id: smb
        ports: [ 445 ]
  ```

  El lienzo dibuja una sola línea con doble punta y una etiqueta por sentido, cada una cerca de la
  punta a la que apunta y con una flechita que dice hacia dónde va (si la flecha es corta, van
  apiladas). `back` solo cuenta con `direction: bidirectional`.
- `ports` son los puertos de destino **sin protocolo asignado** (`ports: [ 8080 ]`). Si la relación
  tiene un solo protocolo son suyos (`[HTTPS :443, :80]`); con varios, cada puerto se muestra con el
  protocolo que lo usa habitualmente (53 con `dns`, 123 con `ntp`) y lo que no se puede asignar
  queda aparte. Los protocolos de red incluyen también `bgp`, `ntp`, `dhcp`, `rdp`, `icmp`, `snmp`,
  `syslog` y `tds` (SQL Server).
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
  # points: recorrido acomodado a mano; la flecha pasa por esos puntos (coordenadas del lienzo)
  payments-api--ledger: { points: [ { x: 280, y: 180 }, { x: 520, y: 180 } ] }
  # from / to: punta fija en un lado del origen o del destino (top, right, bottom, left);
  # `at` es la posición sobre ese lado, de 0 a 1 (sin `at`, al medio)
  payments-api--bus: { from: { side: bottom }, to: { side: left, at: 0.25 } }
  # labelAt: etiqueta movida a mano, a qué altura del trazo va (0 = origen, 1 = destino);
  # backLabelAt: lo mismo para la etiqueta de la vuelta de una relación bidireccional
  payments-api--gateway: { labelAt: 0.25 }
expanded: [ payments-api ]   # abiertos en el lugar: un marco con sus hijos adentro
```

**Varios niveles en un lienzo.** El nivel no limita lo que un lienzo muestra: `level` dice de dónde
parte (y, en L2 y L3, qué elemento es su marco). `expanded` lista los sistemas o contenedores que
el lienzo muestra **abiertos en el lugar**: se dibujan como un marco y sus hijos, que también
están en `nodes`, quedan adentro. Así un lienzo de contexto puede mostrar los contenedores de un
sistema y los componentes de uno de ellos, todo a la vez.

Al cerrar un elemento, lo que contenía sale de `nodes` y su disposición se guarda en `folded`
(por elemento cerrado, relativa a su esquina) para reabrirlo como estaba:

```yaml
folded:
  payments:
    payments-api: { x: 40, y: 64 }
    payments-db: { x: 360, y: 64 }
```

## Despliegue

Un lienzo `level: deployment` muestra dónde corre el software en **un ambiente**
(`environment`, un ID de `environments` del manifiesto) y, opcionalmente, de un sistema (`scope`).
Es el diagrama de despliegue de C4:

- **Nodos** (`kind: node`): lo que aloja software. `node.type` es `datacenter`, `cloud` (nube o
  cuenta), `region`, `zone`, `network` (VPC/VNet), `subnet`, `cluster`, `namespace`, `server`, `vm`,
  `runtime`, `device` u `other`. Se anidan con `parent` y se dibujan como marcos.
- **Infraestructura** (`kind: infra`): por donde pasa el tráfico. `infra.type` es `firewall`,
  `load-balancer`, `dns`, `gateway`, `ingress`, `egress`, `nat`, `vpn`, `link` (enlace dedicado),
  `security-group`, `waf`, `cdn`, `proxy`, `router` u `other`.
- **Instancias** (`kind: instance`): un container, store, bus o system desplegado en un nodo
  (`instance.of`), con `replicas`. En el lienzo toman el color y el ícono de lo que despliegan.
- `addresses` (IPs, CIDRs, hosts, URLs) y `resource` (`vpc-…`, `i-…`, un ARN) se muestran en los
  nodos. `environments` dice en qué ambientes existe cada uno (sin el campo: en todos).

Quién lleva la dirección: el **equipo** (un servidor, una VM) es un nodo con `addresses`; el
**software** que corre en él es una instancia, que puede tener las suyas (un puerto, un nombre de
servicio). Un `system` ubicado directo en un lienzo de despliegue es válido (un SaaS de un tercero)
pero no lleva dirección ni réplicas: la app ofrece convertirlo en nodo o en instancia, y crea el
software nuevo ya desplegado (el elemento lógico más su instancia en el ambiente del lienzo).

```yaml
# views/home-banking-despliegue-qa.yaml
id: home-banking-despliegue-qa
name: Home Banking · Despliegue QA
level: deployment
scope: home-banking
environment: qa
nodes:
  aws: { x: 1800, y: 180, w: 1320, h: 662 }
  vpc-qa: { x: 2240, y: 244, w: 840, h: 558 }
  alb-qa: { x: 2280, y: 308 }
  web-monitoreo-qa: { x: 2740, y: 436 }
```

**Relaciones en el despliegue.** Las relaciones entre contenedores no se repiten: Aegon las
proyecta solas sobre las instancias del lienzo. Si el lienzo ya muestra un **camino de red**
explícito entre dos instancias (actor → firewall → balanceador → instancia), la proyección se
omite, porque el camino ya la cuenta. Los tramos de red (relaciones con nodos, infraestructura o
instancias) se dibujan en azul punteado y pueden llegar a un nodo, por ejemplo un enlace que
entra a una VPC.

**Armar un despliegue sin partir de cero.** En el modo Desplegar de la app:

- **Copiar a otro ambiente** duplica lo propio del ambiente de origen (los nodos, la
  infraestructura y las instancias con `environments: [origen]`) para el ambiente nuevo, con la
  misma disposición y los IDs del ambiente nuevo (`vpc-prod` → `vpc-qa`). Lo que vale para todos
  los ambientes se comparte. No se copian `addresses`, `resource` ni `node.account`, que son de
  cada ambiente; las réplicas salen de `finops.costs.<ambiente>.replicas` si están cargadas.
- **Desplegar todo** crea una instancia de cada contenedor, base y bus que vale para ese ambiente y
  todavía no tiene ninguna, dentro del nodo elegido o de un nodo nuevo (`node.type: other`) que
  después se renombra y se tipa.
- **Comparar** muestra las réplicas de cada parte en cada ambiente que tiene despliegue.

## Datos del documento

`aegon.yaml` guarda también lo que identifica al documento cuando se comparte: `code` (por
ejemplo `ARQ-1024`), `version`, `date` (AAAA-MM-DD), `architect` (autor) y `organization`
(unidad). Aparecen en el **cartel** de las exportaciones a PNG y PDF, junto con el lienzo, su
nivel, el ambiente y el sistema.

## Reglas que valida Aegon

- `parent`, `groups`, `from`, `to`, `scope` y las claves de `nodes` apuntan a elementos existentes.
- Padres válidos según la tabla; sin ciclos.
- Los grupos no tienen relaciones y no puede haber dos relaciones entre el mismo par.
- Un lienzo L2 abre un `system` y uno L3 un `container`. Un lienzo C4 acepta cualquier elemento
  del modelo lógico; los nodos, la infraestructura y las instancias van solo en los de despliegue.
- Un lienzo de despliegue necesita un `environment` del workspace y solo ubica lo que vale para
  ese ambiente; una instancia despliega un container, store, bus o system existente.
- Avisos:
  - Con `strictC4: true` en `aegon.yaml`, un elemento que no es del nivel de su lienzo (un
    componente en un lienzo de contexto). Apagado por defecto.
  - Containers o componentes sin padre, e instancias fuera de un nodo.
  - Elementos que valen en ambientes donde su nodo no existe.
  - Elementos que no están en ningún lienzo.
- `aegon lint` y `analyze` suman:
  - Tráfico sin cifrar (HTTP o puerto 80).
  - Contenedores sin instancia en un ambiente que tiene lienzo de despliegue.
  - Réplica única: algo propio de riesgo alto o crítico que en producción corre con una sola
    réplica, en un nodo que tampoco está repetido. El ambiente productivo se reconoce por su ID o
    nombre ("prod", "Producción"); si ninguno lo dice, es el último de la lista.

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

## Simulador de carga

El modo **Simular** de la app, `aegon simulate` y la herramienta `simulate` del MCP responden lo
mismo: con cierto tráfico de entrada, cuánto le llega a cada parte, qué se queda sin margen primero
y hasta cuánto aguanta. Es un modelo, no una medición: sirve para ver órdenes de magnitud y
encontrar el cuello de botella.

No hace falta cargar nada: el recorrido sale de las relaciones y las réplicas, del despliegue. Dos
campos opcionales afinan el resultado donde se conoce el dato:

```yaml
# model/elements/pagos-api.yaml
load:
  capacity: 450        # pedidos por segundo que atiende UNA réplica

# model/relations/api-gateway--pagos-api.yaml
calls: 0.4             # llamadas al destino por cada pedido que atiende el origen (por defecto 1)
```

Cómo se calcula:

- **Por dónde entra.** Por las relaciones que salen de un actor (repartido entre ellas según su
  `calls`; por defecto, en partes iguales). Sin actores, por lo que nadie llama.
- **Por dónde sigue.** Cada pedido que una parte atiende recorre todas sus relaciones (el peor
  caso); `calls` lo ajusta (`0.4` = cuatro de cada diez, `3` = tres llamadas por pedido). Los
  componentes cuentan para su contenedor.
- **Cuánto aguanta cada parte.** `load.capacity` por la cantidad de réplicas del ambiente: las de
  sus instancias desplegadas; si no hay despliegue, las de `finops.costs.<ambiente>.replicas`; si
  tampoco, una. Sin `load.capacity` se supone por tipo (un servicio, 300 por segundo; una base
  relacional, 1.000; un caché, 20.000…) y el resultado lo marca como supuesto. Un sistema externo y
  una app que corre en el dispositivo del usuario no tienen límite conocido.
- **Qué pasa al saturar.** Una parte atiende hasta su capacidad y solo eso sigue hacia adelante.
  Quien la llama en línea queda frenado. Lo que llega por un bus no frena a nadie: se acumula. Una
  relación hacia un bus se toma como consumo si su etiqueta lo dice ("Consume eventos", "Escucha…").

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

Los **bloques de despliegue** son piezas de infraestructura para no arrancar un despliegue de
cero: una red con subredes y balanceador, un clúster con namespaces, un datacenter con firewall y
el borde web (DNS, CDN y WAF). Se insertan solo en lienzos `level: deployment`, y ahí no entran
los bloques de C4. Vienen sin proveedor ni direcciones, para completar. Al insertarlos:

- Cada nodo, infraestructura o instancia queda con `environments: [<ambiente del lienzo>]`.
- Se conservan el anidado (`parent`) y el layout del bloque: cada marco envuelve a sus hijos.
- Si el bloque se suelta dentro de un nodo del lienzo (doble click adentro), sus elementos de
  primer nivel toman ese nodo como `parent`. Si no entra, el nodo y los que lo contienen crecen
  para seguir envolviéndolo, y lo que tenían al lado se corre.

Los templates incluidos vienen con la app. Los que guarda el usuario ("Guardar como template…"
sobre una selección o sobre el workspace) quedan en la biblioteca local del navegador o de la app de
escritorio; no forman parte de los archivos del workspace.
