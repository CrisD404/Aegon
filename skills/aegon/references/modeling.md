# Modelado en Aegon

Qué se modela, con qué tipo y cómo se escribe. Los comandos están en [cli.md](cli.md) y los errores en [repair.md](repair.md).

## Principios

- **Un modelo, muchos lienzos.** Los elementos y relaciones existen una sola vez (`model/`); un lienzo (`views/`) solo dice cuáles muestra y dónde. El mismo elemento puede estar en varios lienzos.
- **Un archivo por entidad.** El nombre del archivo es el `id`: `model/elements/<id>.yaml`, `model/relations/<id>.yaml`, `views/<id>.yaml`, `flows/<id>.yaml`.
- **IDs legibles e inmutables.** Salen del nombre (`API de pedidos` → `api-de-pedidos`; si ya existe, `api-de-pedidos-2`). Para renombrar se cambia `name`, nunca el `id`.
- **Sin ruido.** Los campos con valor por defecto se omiten (`scope: internal`, `status: live`, `direction: outgoing`).
- **Solo los campos del formato.** Un campo que Aegon no conoce no da error y desaparece la próxima vez que Aegon escribe ese archivo. Lo que no tenga campo propio va en `properties` (clave → texto).

## Elementos

| `kind` | Qué es | `parent` | Opciones de `add` |
|---|---|---|---|
| `actor` | Persona o rol que usa el sistema | — | `--role`, `--external` |
| `system` | Sistema de software, propio o externo | — | `-t`, `--external`, `--risk` |
| `container` | Algo que corre por separado: web, app móvil, API, worker, función | `system` | `--container-type web\|mobile\|desktop\|api\|service\|worker\|function\|other`, `-t`, `--risk` |
| `component` | Parte interna de un contenedor | `container` | `-t` |
| `store` | Base de datos, caché, bucket, índice | `system` o `container` | `--engine` |
| `bus` | Cola, tópico o stream de mensajería | `system` | `--broker`, `--topics a,b` |
| `group` | Marco visual: nube, red, datacenter, plataforma | `group` | `--provider aws\|gcp\|azure\|onprem\|network\|platform\|other`, `--region` |
| `node` | Despliegue: algo que aloja software | `node` | `--node-type`, `--provider`, `--region`, `--account`, `--size`, `--instances` |
| `infra` | Despliegue: por donde pasa el tráfico | `node` | `--infra-type` |
| `instance` | Despliegue: un contenedor, base, bus o sistema desplegado | `node` | `--of`, `--replicas` |

Opciones para cualquier tipo: `-d` (descripción corta, se ve en el nodo), `--external`, `--status planned|live|changing|deprecated|retired` (nuevo, existente, se modifica, se da de baja, retirado), `--risk low|medium|high|critical` (no en actores, grupos ni instancias), `--group <id>` (repetible), `--tags a,b`, `--owner`, `--env a,b`, `--parent`, `--view`, `--id`.

Solo en YAML: `docs` (Markdown largo), `links` (`[{ url, label }]`), `properties`, `store.version`, `store.managed` (`aws-rds`), `bus.type`, `group.account`, `group.cidr`, `finops`.

```yaml
# model/elements/api-de-pedidos.yaml
id: api-de-pedidos
kind: container
name: API de pedidos
description: Recibe y cobra los pedidos
parent: tienda-online
risk: high
technology: [ nodejs ]
containerType: api
```

Qué tipo elegir:

- Una base de datos o un bus son `store` y `bus`, no `container`: se describen por su motor (`store.engine`) o su broker (`bus.broker`), no por `technology`.
- Un servicio de terceros (pasarela de pagos, proveedor de correo, identidad) es un `system` con `--external`. No modeles su interior.
- Una persona externa a la organización (un cliente) es un `actor` con `--external`.
- Un `group` no es parte de la jerarquía C4: es un marco. La pertenencia va en `groups` del elemento (`--group`), no en `parent`. Los grupos no tienen relaciones.

## Relaciones

```yaml
# model/relations/api-de-pedidos--pedidos-db.yaml
id: api-de-pedidos--pedidos-db
from: api-de-pedidos
to: pedidos-db
label: Lee y escribe pedidos
protocols: [ jdbc ]
ports: [ 5432 ]
```

- **Una relación por par de elementos.** Si la comunicación va en los dos sentidos, `direction: bidirectional` (`--bidirectional`). Si hay varios motivos, resumilos en la etiqueta.
- **Cada sentido con lo suyo.** En una bidireccional, `label` y `protocols` son los de la ida (`from` → `to`); lo que va de vuelta se declara aparte, con los puertos por los que escucha `from`: `--back-label "Replica perfiles" --back-protocols smb:445` en la CLI, `back: { label: Replica perfiles, protocols: [ { id: smb, ports: [ 445 ] } ] }` en el YAML. El lienzo dibuja una etiqueta por sentido.
- **Entre los elementos más específicos.** Conectá contenedor con contenedor (o componente con componente); en los niveles de arriba Aegon dibuja la relación implícita entre los ancestros, punteada. No dupliques la relación entre sistemas.
- **No conectes un elemento con su propio padre o hijo**, ni un actor directo a una base de datos: pasá por el contenedor que la usa.
- `from` es quien inicia la comunicación. La etiqueta dice qué hace, en presente: "Crea pedidos", "Publica pedidos.creados", "Consume pedidos.creados".
- Cuando importa por qué puerto va cada protocolo (redes, firewalls), el puerto va junto al protocolo: `-p dns:53,ntp:123,ldap:389/636` en la CLI, `protocols: [ { id: dns, ports: [ 53 ] } ]` en el YAML. `--ports` y `ports` quedan para puertos sin protocolo.
- `protocols` usa el catálogo (abajo). Un productor o un consumidor de un bus se conectan **hacia** el bus con el protocolo del broker (`kafka`, `amqp`).

### Carga (opcional)

`simulate` responde cuánto tráfico aguanta el modelo sin cargar nada. Solo si tenés el dato real, afinalo: `load: { capacity: 450 }` en un container, store, bus o system son los pedidos por segundo que atiende una réplica, y `calls: 0.4` en una relación son las llamadas al destino por cada pedido que atiende el origen (por defecto 1). No inventes capacidades: lo que falta se supone por tipo y `simulate` lo marca como supuesto.

## Lienzos

`init` crea `contexto` (L1). Los demás se escriben a mano; `add --view` y `layout` completan `nodes`.

```yaml
# views/tienda-online-containers.yaml
id: tienda-online-containers
name: Tienda Online · Contenedores
level: 2                # 1 contexto · 2 contenedores · 3 componentes · deployment
scope: tienda-online    # L2: el system que se abre · L3: el container · L1: sin scope
nodes:                  # obligatorio; vacío es `nodes: {}`
  cliente: { x: 0, y: 0 }
  pasarela-de-pagos: { x: 0, y: 0 }
```

- IDs y nombres que usa la app: `<sistema>-containers` con nombre `<Sistema> · Contenedores`; `<contenedor>-components` con `<Contenedor> · Componentes`. Un lienzo de detalle por sistema o contenedor.
- En `nodes` van los elementos que el lienzo muestra, con la esquina superior izquierda de cada uno. El elemento de `scope` no se ubica: es el marco.
- **Vecinos.** Un L2 muestra también los actores y sistemas externos con los que hablan sus contenedores. Como ya existen, agregalos a `nodes` con `{ x: 0, y: 0 }` y dejá que `layout` los ordene.
- **Hijos.** `add container|store|bus … --view <L2>` crea el elemento dentro del sistema del lienzo; `add component … --view <L3>`, dentro del contenedor. En otros casos indicá `--parent`.
- Un elemento con `parent` correcto que no figura en `nodes` de ningún lienzo no se ve: `validate --info` lo lista como `[not-in-view]`.
- No hace falta calcular coordenadas: `layout <lienzo>` las reescribe todas.
- **Varios niveles en un lienzo.** El nivel no limita lo que un lienzo muestra. Con `expanded: [ <id> ]` un sistema (o un contenedor) se ve abierto en el lugar: un marco con sus hijos adentro, que también van en `nodes`. La persona lo hace en la app con doble click; armalo en YAML solo si te piden un único lienzo con todo, y corré `layout` después.

## Despliegue

Dónde corre el software en **un ambiente**. Hace falta:

1. El ambiente en el manifiesto:

   ```yaml
   # aegon.yaml
   environments:
     - { id: prod, name: Producción }
   ```

2. Un lienzo de despliegue, escrito a mano:

   ```yaml
   # views/tienda-online-despliegue-prod.yaml
   id: tienda-online-despliegue-prod
   name: Tienda Online · Despliegue Producción
   level: deployment
   scope: tienda-online   # opcional: el sistema cuyo despliegue se muestra
   environment: prod      # obligatorio
   nodes: {}
   ```

3. Los elementos, con `--view <lienzo> --env <ambiente>`:

   - **Nodos** (`add node "Clúster" --node-type cluster --parent nube`): lo que aloja software. `--node-type`: `datacenter`, `cloud`, `region`, `zone`, `network` (VPC), `subnet`, `cluster`, `namespace`, `server`, `vm`, `runtime`, `device`, `other`. Se anidan con `--parent` y se dibujan como marcos.
   - **Infraestructura** (`add infra "Balanceador" --infra-type load-balancer --parent nube`): `firewall`, `load-balancer`, `dns`, `gateway`, `ingress`, `egress`, `nat`, `vpn`, `link`, `security-group`, `waf`, `cdn`, `proxy`, `router`, `other`.
   - **Instancias** (`add instance --of web --parent cluster --replicas 2`): el nombre es opcional (toma el del elemento) y el ID queda `<elemento>-<ambiente>` (`web-prod`).
   - `--addresses` (IPs, CIDRs, hosts, URLs) y `--resource` (ID en el proveedor) en nodos, infraestructura e instancias.

Reglas:

- Las relaciones entre contenedores **no se repiten** entre instancias: Aegon las proyecta solas.
- El camino de red sí se modela, con relaciones comunes: `connect cliente balanceador`, `connect balanceador web-prod`. Pueden llegar a un nodo (un enlace que entra a una VPC).
- En un lienzo de despliegue se ubican instancias, nodos, infraestructura, actores y sistemas externos. Un contenedor no se ubica directo: se despliega como instancia.
- Un servidor, una VM o un equipo es un **nodo** (`--node-type server|vm`) y lleva la IP en `--addresses`. Lo que corre en él (un servicio, un directorio, un DNS) es software: se modela como sistema o contenedor y se despliega con `add instance --of <id> --parent <nodo>`. No modeles un servidor como sistema: un sistema no lleva dirección.
- Para mostrar un cambio (qué se agrega, qué se toca, qué se saca) usá `--status` en lo que cambia y dejá sin marcar lo que ya existe: `planned` es nuevo, `changing` existe y se modifica, `deprecated` se da de baja. No hace falta marcar todo: lo que está dentro de un nodo `planned` y las relaciones que llegan a él se ven nuevos solos. Una relación nueva entre dos cosas que ya existen (una regla de firewall que hay que abrir) se marca en la relación: `connect a b --status planned`.
- `lint` avisa (`[not-deployed]`) por cada contenedor, base o bus del sistema desplegado que no tenga instancia en ese ambiente. Desplegalos o contá en la respuesta que el despliegue es parcial.
- Usá direcciones y hosts reales solo si salen del repositorio que estás leyendo; en ejemplos, `example.com`.

## Flujos

Un recorrido paso a paso sobre el modelo, que la app reproduce como presentación. Se escribe a mano:

```yaml
# flows/compra.yaml
id: compra
name: Compra de un producto
description: Desde que el cliente confirma el carrito hasta que recibe el aviso.
view: tienda-online-containers        # lienzo donde arranca
steps:
  - { type: message, from: web, to: api-de-pedidos, title: POST /pedidos }
  - type: process                      # un elemento hace algo por su cuenta
    element: api-de-pedidos
    title: Valida el stock
    description: "Detalle en Markdown: payload, reglas…"
  - type: paths                        # bifurcación
    mode: alternate                    # alternate: uno u otro · parallel: todos a la vez
    title: ¿Se aprobó el pago?
    paths:
      - name: Aprobado
        steps:
          - { type: message, from: api-de-pedidos, to: pedidos-db, title: Guarda el pedido }
      - name: Rechazado
        steps:
          - { type: note, title: El pedido no se guarda }
  - { type: goto, flow: notificar-cliente }   # sigue en otro flujo (tiene que existir) y vuelve
  - { type: note, title: Fin }                # contexto, sin elementos
```

- Un `message` usa la relación que une a `from` y `to`, en cualquier sentido. **Conectá primero**: sin relación el paso se guarda igual, pero la app dibuja una flecha provisoria. `flow <id> --json` muestra la `relation` de cada mensaje; si falta, falta el `connect`.
- Los caminos tienen un solo nivel: un camino no contiene otra bifurcación.
- Los pasos se numeran solos: `1`, `2`, `3`, y dentro de un camino `3A.1`, `3B.2`. No pongas números en `title`.
- Si un título lleva `:` o `#`, o una coma dentro de `{ }`, ponelo entre comillas.
- `flow <id>` muestra el flujo como texto para revisarlo; `export flow <id> mermaid` lo da como diagrama de secuencia.

## Catálogos

`add` y `connect` aceptan el ID, el nombre o una palabra clave y guardan el ID. Lo que no esté en el catálogo se guarda tal cual, con un aviso: es válido. Estos son los IDs más usados.

- **Tecnologías** (`-t`, solo en `system`, `container`, `component`, `node`, `infra`): `java` `kotlin` `typescript` `javascript` `python` `go` `dotnet` `php` `ruby` `rust` `scala` `swift` `dart` `elixir` · `spring-boot` `quarkus` `nodejs` `nestjs` `express` `fastapi` `django` `flask` `laravel` `rails` · `react` `nextjs` `angular` `vue` `svelte` `flutter` `react-native` `android` `ios` · `docker` `kubernetes` `nginx` `apache` `kong` `istio` `terraform` `openshift` `linux` · `aws-lambda` `cloud-run` `cloud-functions` `azure-functions` `aws-api-gateway` `cloudfront` `cloudflare` · `keycloak` `auth0` `okta` `entra-id` `salesforce` `sap`.
- **Motores** (`--engine`): `postgresql` `mysql` `mariadb` `sqlserver` `oracle` `sqlite` `aurora` `cloudsql` `cockroachdb` · `mongodb` `couchbase` `firestore` `cosmosdb` · `dynamodb` `cassandra` · `redis` `memcached` · `elasticsearch` `opensearch` · `s3` `gcs` `blob` · `neo4j` · `influxdb` `timescaledb` · `snowflake` `bigquery` `redshift` `clickhouse`.
- **Brokers** (`--broker`): `kafka` `rabbitmq` `activemq` `pulsar` `nats` `redis-streams` `mosquitto` `ibm-mq` `sqs` `sns` `eventbridge` `kinesis` `pubsub` `service-bus` `event-hubs`.
- **Protocolos** (`-p`): `https` `rest` `grpc` `graphql` `websocket` `sse` `soap` `webhook` `http` · `kafka` `amqp` `jms` `mqtt` `nats` `pulsar` `stomp` · `jdbc` `sql` `odbc` `mongodb-wire` `resp` `memcached` `cql` `bolt` `s3-api` `search-api` `dynamodb-api` · `sftp` `ftps` `smb` `nfs` · `oauth2` `oidc` `saml` `ldap` `kerberos` · `smtp` `imap` · `tcp` `udp` `ssh` `dns` `vpn` `bgp` `tds`.

Sin protocolo, `connect` sugiere los que encajan con el destino (JDBC hacia PostgreSQL, Kafka hacia un bus Kafka).

## Desde un repositorio

Modelá lo que el código demuestra. Buscá la evidencia en este orden y anotá de dónde sale cada cosa:

| Evidencia | Qué da |
|---|---|
| `docker-compose.yml`, manifiestos de Kubernetes, Helm, `Procfile` | Contenedores, bases, buses y quién depende de quién |
| Workspaces o carpetas con su propio `package.json`, `pom.xml`, `go.mod`, `pyproject.toml`, `*.csproj` | Un contenedor por desplegable; `technology` |
| Variables de entorno y configuración (`DATABASE_URL`, `KAFKA_BROKERS`, URLs de otros servicios) | Relaciones y protocolos; sistemas externos |
| Clientes HTTP, SDKs, drivers, productores y consumidores | Relaciones y su sentido |
| Rutas, controladores, páginas | Actores (quién usa qué) y componentes |
| Terraform, CloudFormation, Pulumi, pipelines de despliegue | Nodos, infraestructura, instancias y ambientes |
| README y documentación | Nombres de negocio, actores, contexto |

Criterio:

- Un contenedor es algo que se despliega o corre por separado, no una carpeta ni una librería. Una librería compartida, a lo sumo, es un componente.
- Lo que el repo usa pero no contiene (una API de terceros, el proveedor de identidad, otro equipo) es un sistema externo.
- Las personas salen de los roles o permisos del código y de la documentación. Si no hay evidencia, poné el actor más obvio y decilo.
- No inventes bases, colas ni servicios "que seguro están". Si algo es probable pero no lo viste, dejalo afuera y contalo en la respuesta. `--status planned` es para lo que el repo dice que está planificado, no para lo que suponés.
- Nunca copies al modelo secretos, tokens ni cadenas de conexión con credenciales.
- En un monorepo grande, acordá el alcance (un sistema) antes de modelar todo.
