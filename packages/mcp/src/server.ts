import { McpServer } from '@modelcontextprotocol/server';
import { VERSION } from '@aegon/cli';
import { Session } from './session.ts';
import { registerTools } from './tools.ts';

/** Instrucciones que el cliente MCP le pasa al modelo al conectarse. */
export const INSTRUCTIONS = `Aegon guarda arquitectura C4 (niveles 1 a 3 y despliegue por ambiente) como código: un YAML por elemento, relación y lienzo en la carpeta del workspace. Estas herramientas leen y modifican ese modelo; cada escritura se valida con las reglas de C4 y se guarda en disco al instante (la app de escritorio de Aegon la muestra en vivo como un cambio sin commitear).

Flujo recomendado:
1. get_workspace para orientarte; list_elements, get_element y get_view para encontrar IDs.
2. add_element para crear. Pasá \`view\` para ubicarlo: en un lienzo L2 (contenedores de un sistema) un container nuevo queda dentro de ese sistema. create_child_view abre o crea el lienzo L2 de un sistema o L3 de un contenedor.
3. connect para relacionar. Conectá los elementos más específicos (container → container): Aegon deriva las relaciones entre sistemas. Hay una sola relación por par (conectar al revés la vuelve bidireccional). Declará \`protocols\` con IDs del catálogo (search_catalog).
4. validate y analyze al terminar; layout_view si el lienzo quedó desordenado.

Despliegue (dónde corre cada cosa en un ambiente): definí los ambientes con update_workspace (\`environments\`) y creá el lienzo con create_view (\`level: deployment\`, \`environment\`). Ahí van nodos (\`kind: node\`: datacenter, cloud, network/VPC, cluster, namespace, server, vm…, anidados con \`parent\`), infraestructura (\`kind: infra\`: firewall, load-balancer, dns, ingress, egress, link, security-group…) e instancias (\`kind: instance\` con \`of\`: el container, store o system que corre ahí). IPs, hosts y URLs van en \`addresses\`; IDs de nube (vpc-…, i-…) en \`resource\`. No repitas en el despliegue las relaciones entre contenedores: Aegon las dibuja solas entre sus instancias. Conectá solo el camino de red (actor → firewall → balanceador → instancia), con \`ports\`.

Flujos y comentarios: un flujo cuenta un recorrido paso a paso (quién le habla a quién y en qué orden) y la app lo reproduce como presentación. get_flow lo trae con los pasos numerados (1, 2, 5A.1…); create_flow y add_flow_step lo arman (cada message usa la relación entre sus extremos: conectalos antes). add_comment deja una nota o pregunta en un lienzo, anclada a un elemento si pasás \`element\`; list_comments con status=open muestra lo pendiente, reply_comment y resolve_comment siguen el hilo.

Reglas: los IDs son slugs inmutables (para renombrar cambiá \`name\`). Padres válidos: container → system, component → container, store → system o container, bus → system, group → group. technology va en system/container/component; una base de datos se describe por su motor (engine) y un bus por su broker. Los grupos (cloud, red, on-prem) no tienen relaciones; los nodos de despliegue sí. Nodos, infraestructura e instancias cuelgan de nodos. Las herramientas aceptan IDs o nombres exactos.`;

export interface AegonServerOptions {
  /** Carpeta del workspace (la que tiene aegon.yaml). */
  root: string;
}

export function createAegonServer(options: AegonServerOptions): { server: McpServer; session: Session } {
  const server = new McpServer({ name: 'aegon', title: 'Aegon', version: VERSION }, { instructions: INSTRUCTIONS });
  const session = new Session(options.root);
  registerTools(server, session);
  return { server, session };
}
