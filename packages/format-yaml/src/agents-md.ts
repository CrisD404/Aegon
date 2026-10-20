export const GITATTRIBUTES = `# Aegon: archivos de texto con LF en todas las plataformas
* text=auto eol=lf
`;

export const GITIGNORE = `# Aegon: estado local de borrador y recuperación (no se versiona)
.aegon/
`;

/** Guía del formato que se escribe en cada workspace para que cualquier agente de IA lo entienda. */
export function agentsMd(workspaceName: string): string {
  return `# ${workspaceName} — guía para agentes

Este repositorio es un workspace de **Aegon**: arquitectura C4 (niveles 1 a 3 y despliegue por ambiente)
guardada como código.
La app de Aegon lee y escribe estos archivos; vos también podés editarlos directamente.

## Estructura

\`\`\`
aegon.yaml                   # manifiesto del workspace (schema: 2)
model/elements/<id>.yaml     # un archivo por elemento
model/relations/<id>.yaml    # un archivo por relación
views/<id>.yaml              # un archivo por lienzo (diagrama)
flows/<id>.yaml              # flujos: secuencias de pasos que se reproducen como presentación
comments/<id>.yaml           # comentarios sobre un lienzo (con respuestas)
attachments/                 # adjuntos que Aegon conserva tal cual
\`\`\`

- El **modelo** (elementos y relaciones) es único; los **lienzos** solo ubican elementos del modelo.
  Un mismo elemento puede aparecer en varios lienzos: es el mismo objeto, no una copia.
- El nombre de archivo es el \`id\`. Los IDs son slugs legibles (\`payments-api\`) e **inmutables**:
  para renombrar, cambiá \`name\`, nunca el \`id\`.
- Omití los campos con valor por defecto (\`scope: internal\`, \`status: live\`, \`direction: outgoing\`).

## Elementos (\`kind\`)

| kind | Nivel | Padre (\`parent\`) | Campos propios |
|---|---|---|---|
| \`actor\` | 1–3 | — | \`role\`, \`scope: external\` si es externo |
| \`system\` | 1 | — | \`technology\`, \`risk\` |
| \`container\` | 2 | system | \`containerType\` (web, mobile, desktop, api, service, worker, function, other), \`technology\`, \`risk\` |
| \`component\` | 3 | container | \`technology\`, \`risk\` |
| \`store\` | 1–3 | system o container | \`store: { engine, type, version, managed }\` (\`engine: other\` + \`customEngine\`), \`risk\` |
| \`bus\` | 1–3 | system | \`bus: { broker, type, topics }\` (kafka, rabbitmq, sqs…; \`broker: other\` + \`customBroker\`), \`risk\` |
| \`group\` | 1–3 | group | \`group: { provider: aws\\|gcp\\|azure\\|onprem\\|network\\|platform\\|other, region, account, cidr }\` |
| \`node\` | despliegue | node | \`node: { type, provider, region, account, size, instances }\`, \`technology\`, \`addresses\`, \`resource\` |
| \`infra\` | despliegue | node | \`infra: { type }\` (firewall, load-balancer, dns, gateway, ingress, egress, nat, vpn, link, security-group, waf, cdn, proxy, router, other), \`technology\`, \`addresses\`, \`resource\` |
| \`instance\` | despliegue | node | \`instance: { of, replicas }\` (\`of\`: el container, store, bus o system que despliega), \`addresses\`, \`resource\` |

Campos comunes: \`name\`, \`description\` (corta), \`docs\` (Markdown), \`groups\` (IDs de grupos),
\`scope\` (internal/external), \`status\` (planned/live/deprecated/retired), \`tags\`, \`owner\`, \`links\`,
\`properties\` (clave → texto). \`risk\` (low/medium/high/critical) va en todo menos actor y group.
\`technology\` (lenguajes, frameworks, plataformas) va solo en system, container y component: una
base de datos se describe por su motor y un bus de mensajería por su broker.

\`\`\`yaml
# model/elements/payments-api.yaml
id: payments-api
kind: container
name: Payments API
description: Autoriza y registra pagos
parent: payments
containerType: api
technology: [java, spring-boot]
risk: high
\`\`\`

### Ambientes y costos (FinOps)

Los ambientes se definen en \`aegon.yaml\` (\`environments: [{ id, name }]\`, en orden) junto con
\`finops: { currency, tagKeys, budgets }\`. En cada elemento, \`environments\` lista dónde está desplegado
(sin el campo: en todos) y \`finops.costs\` el costo **mensual** por ambiente; las etiquetas de
asignación van en \`finops.tags\` y se heredan del padre.

\`\`\`yaml
environments: [qa, prod]
finops:
  costs:
    qa: { monthly: 90 }
    prod: { monthly: 980, replicas: 4, sku: m6i.large }
  tags: { cost-center: CC-1200 }
\`\`\`

Los costos van en los elementos desplegables (contenedores, bases, buses); un sistema suma los de
sus hijos. Los actores no tienen costos. Solo usá IDs de ambientes que existan en \`aegon.yaml\`.

### Despliegue

Dónde y cómo corre el software en cada ambiente (C4 deployment):

- \`node\`: algo que aloja software (datacenter, nube, VPC, clúster, namespace, servidor, VM). Se
  anidan con \`parent\` (\`Datacenter > OCP > namespace BANCA\`). \`node.type\`: datacenter, cloud, region,
  zone, network, subnet, cluster, namespace, server, vm, runtime, device u other.
- \`infra\`: infraestructura por la que pasa el tráfico (firewall, DNS, balanceador, ingress/egress,
  enlace dedicado, security group…).
- \`instance\`: un contenedor (o base, bus, sistema) desplegado en un nodo: \`instance.of\` apunta al
  elemento lógico. Las relaciones entre contenedores **no se repiten**: Aegon las dibuja solas entre
  sus instancias, salvo que el lienzo ya muestre un camino de red explícito entre ellas.
- \`addresses\`: IPs, CIDRs, hostnames o URLs (\`10.20.30.85\`, \`banca-qa.apps.ocp.example:8080\`).
  \`resource\`: ID del recurso en el proveedor (\`vpc-0a1b…\`, \`i-0123…\`, un ARN).
- \`environments\` dice en qué ambientes existe cada nodo, infraestructura o instancia (sin el campo:
  en todos, por ejemplo un datacenter compartido). Una instancia suele ser de un solo ambiente
  (\`web-app-qa\`).
- Las relaciones de red (actor → firewall → balanceador → instancia) son relaciones comunes entre
  esos elementos; pueden apuntar a un \`node\` (por ejemplo, a la VPC).

\`\`\`yaml
# model/elements/web-app-qa.yaml
id: web-app-qa
kind: instance
name: Web App
parent: namespace-banca
instance: { of: web-app, replicas: 2 }
environments: [qa]
\`\`\`

## Relaciones

\`\`\`yaml
# model/relations/payments-api--payments-db.yaml
id: payments-api--payments-db
from: payments-api
to: payments-db
label: Lee y escribe transacciones
protocols: [jdbc]
\`\`\`

- **Una relación por par de elementos.** Si la comunicación va en ambos sentidos usá
  \`direction: bidirectional\` en vez de dos relaciones.
- \`protocols\` usa los IDs del catálogo de Aegon (\`https\`, \`rest\`, \`grpc\`, \`graphql\`, \`kafka\`,
  \`amqp\`, \`jdbc\`, \`sql\`, \`tds\`, \`resp\`, \`s3-api\`, \`sftp\`, \`oidc\`, \`tcp\`, \`bgp\`…) y \`ports\` los
  puertos de destino (\`ports: [443, 80]\`).
- Conectá los elementos más específicos posibles (container → container). Aegon dibuja las
  relaciones implícitas en los niveles superiores (sistema → sistema) automáticamente.

## Flujos y comentarios

Un flujo (\`flows/<id>.yaml\`) tiene \`name\`, \`description\`, \`view\` (lienzo donde se reproduce) y
\`steps\`: \`message\` (\`from\` → \`to\`, opcional \`relation\`), \`process\` (\`element\`), \`note\`,
\`goto\` (\`flow\`) y \`paths\` (\`mode: alternate|parallel\`, \`paths: [{ name, steps }]\`). Cada paso
puede tener \`title\` y \`description\` (Markdown). Los pasos referencian IDs de elementos.

Un comentario (\`comments/<id>.yaml\`) está en un \`view\`, en \`x\`/\`y\` (relativos al elemento si tiene
\`element\`), con \`body\`, \`author\`, \`at\` (ISO 8601), y opcionalmente \`title\`, \`icon\`, \`color\`,
\`resolved\` y \`replies\`. No borres comentarios de otras personas sin que te lo pidan.

## Lienzos

\`\`\`yaml
# views/payments-containers.yaml
id: payments-containers
name: Payments · Contenedores
level: 2            # 1 = contexto, 2 = contenedores, 3 = componentes, deployment = despliegue
scope: payments     # system en L2, container en L3; vacío en L1; en despliegue, el sistema (opcional)
nodes:              # posición (esquina superior izquierda) de cada elemento ubicado
  payments-api: { x: 0, y: 0 }
  payments-db: { x: 320, y: 0, w: 224, h: 120 }
edges:              # opcional: estilo de las relaciones que se apartan del default
  payments-api--payments-db: { shape: step }
\`\`\`

## Reglas

- Cada \`parent\`, \`groups\`, \`from\`, \`to\`, \`scope\` y clave de \`nodes\` debe apuntar a un elemento existente.
- Los grupos no tienen relaciones. Un lienzo L2 abre un \`system\`; uno L3 abre un \`container\`.
- Un lienzo \`level: deployment\` necesita \`environment\` (un ambiente de \`aegon.yaml\`) y ubica
  nodos, infraestructura, instancias, actores y sistemas externos.
- Los JSON Schema del formato están en la documentación de Aegon (\`docs/schema/*.schema.json\`).

## Herramientas

- **Servidor MCP** (\`@aegon/mcp\`): si está conectado, preferilo a editar los YAML a mano. Sus
  herramientas (\`add_element\`, \`connect\`, \`place\`, \`create_child_view\`…) aplican las reglas de C4,
  generan IDs únicos y escriben solo los archivos que cambian.
- **CLI** (\`aegon\`): \`aegon validate\` después de editar a mano; \`aegon lint\` para huérfanos, ciclos,
  relaciones sin protocolo y hotspots de riesgo; \`aegon diff\` para ver los cambios del modelo.
`;
}
