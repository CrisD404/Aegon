import { parseArgs, type ParseArgsConfig } from 'node:util';
import { resolve } from 'node:path';
import { OpError, RISKS, STATUSES, type Risk, type Status } from '@aegon/core';
import { lint, validate } from './commands/check.ts';
import { diff } from './commands/diff.ts';
import { add, connect, layout } from './commands/edit.ts';
import { exportCommand, exportFlowCommand } from './commands/export.ts';
import { comments, flow, flows } from './commands/flows.ts';
import { init } from './commands/init.ts';
import { UsageError, list, type Io } from './io.ts';
import { Workspace, WorkspaceError } from './workspace.ts';

export const VERSION = '0.1.0';

type Options = NonNullable<ParseArgsConfig['options']>;
type Values = Record<string, string | boolean | string[] | undefined>;

const GLOBAL: Options = {
  workspace: { type: 'string', short: 'w' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

interface Command {
  usage: string;
  summary: string;
  help: string;
  options: Options;
  run(io: Io, positionals: string[], values: Values): Promise<number>;
}

const str = (v: Values[string]) => (typeof v === 'string' ? v : undefined);
const num = (v: Values[string], name: string) => {
  if (typeof v !== 'string') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new UsageError(`--${name} tiene que ser un número`);
  return n;
};

function oneOf<T extends string>(v: Values[string], allowed: readonly T[], name: string): T | undefined {
  if (typeof v !== 'string') return undefined;
  if (!(allowed as readonly string[]).includes(v)) throw new UsageError(`--${name} inválido "${v}": usá ${allowed.join(', ')}`);
  return v as T;
}

async function openWorkspace(io: Io, values: Values): Promise<Workspace> {
  const dir = str(values.workspace);
  return Workspace.open(resolve(io.cwd, dir ?? '.'), { searchUp: !dir });
}

function need(positionals: string[], count: number, usage: string) {
  if (positionals.length < count) throw new UsageError(`Faltan argumentos. Uso: aegon ${usage}`);
  if (positionals.length > count) throw new UsageError(`Sobran argumentos (${positionals.slice(count).join(' ')}). Uso: aegon ${usage}`);
}

const COMMANDS: Record<string, Command> = {
  init: {
    usage: 'init [carpeta]',
    summary: 'Crea un workspace (vacío o el de ejemplo)',
    help: `Opciones:
  --name <nombre>          Nombre del workspace (por defecto, el de la carpeta)
  --demo                   Usa el workspace de ejemplo (banca digital)`,
    options: { name: { type: 'string' }, demo: { type: 'boolean' } },
    run: (io, pos, v) => {
      if (pos.length > 1) throw new UsageError('Uso: aegon init [carpeta]');
      return init(io, pos[0] ?? str(v.workspace), { name: str(v.name), demo: !!v.demo, json: !!v.json });
    },
  },
  validate: {
    usage: 'validate',
    summary: 'Valida formato, referencias y reglas C4',
    help: `Opciones:
  --info                   Incluye diagnósticos informativos (elementos fuera de todo lienzo)
  --strict                 Los avisos también hacen fallar (código de salida 1)`,
    options: { info: { type: 'boolean' }, strict: { type: 'boolean' } },
    run: async (io, pos, v) => {
      need(pos, 0, 'validate');
      return validate(io, await openWorkspace(io, v), { info: !!v.info, strict: !!v.strict, json: !!v.json });
    },
  },
  lint: {
    usage: 'lint',
    summary: 'Validación + análisis: huérfanos, ciclos, violaciones C4, protocolos y riesgo',
    help: `Opciones:
  --strict                 Avisos, huérfanos y ciclos también hacen fallar
  --hotspots <n>           Cuántos hotspots de riesgo mostrar (por defecto 10)`,
    options: { strict: { type: 'boolean' }, hotspots: { type: 'string' } },
    run: async (io, pos, v) => {
      need(pos, 0, 'lint');
      return lint(io, await openWorkspace(io, v), { strict: !!v.strict, json: !!v.json, hotspots: num(v.hotspots, 'hotspots') ?? 10 });
    },
  },
  add: {
    usage: 'add <kind> [nombre]',
    summary: 'Agrega un elemento (actor, system, container, component, store, bus, group, node, infra, instance)',
    help: `Opciones:
  --parent <id>            Padre en la jerarquía C4 (container → system, component → container)
  --view <id>              Lienzo donde ubicarlo (hereda el padre del lienzo si no se indica)
  --x <n> --y <n>          Posición en el lienzo (por defecto, un lugar libre)
  --id <id>                ID explícito (por defecto, el slug del nombre)
  -d, --description <txt>  Descripción corta
  -t, --technology <a,b>   Tecnologías (catálogo: java, spring-boot, react, go…)
  --container-type <tipo>  web, mobile, desktop, api, service, worker, function, other
  --engine <motor>         Motor de una base (postgresql, mongodb, redis…)
  --broker <broker>        Broker de un bus (kafka, rabbitmq, sqs…)
  --topics <a,b>           Tópicos o colas de un bus
  --provider <p>           Proveedor de un grupo (aws, gcp, azure, onprem, network, platform) o de un nodo (aws, openshift…)
  --region <región>        Región de un grupo o nodo
  --role <rol>             Rol de un actor

Despliegue:
  --node-type <tipo>       Nodo: datacenter, cloud, region, zone, network, subnet, cluster, namespace, server, vm…
  --size <tamaño>          Nodo: tamaño o tipo de instancia (m5.2xlarge)
  --instances <n>          Nodo: cantidad de nodos iguales
  --account <cuenta>       Nodo: cuenta, suscripción o proyecto
  --infra-type <tipo>      Infraestructura: firewall, load-balancer, dns, gateway, ingress, egress, nat, vpn, link…
  --of <id>                Instancia: el container, store, bus o system que despliega (el nombre es opcional)
  --replicas <n>           Instancia: réplicas
  --addresses <a,b>        IPs, CIDRs, hosts o URLs
  --resource <id>          ID del recurso en el proveedor (vpc-…, i-…, ARN)
  --env <a,b>              Ambientes donde existe
  --external               Elemento externo (fuera de la organización)
  --status <estado>        planned, live, deprecated, retired
  --risk <riesgo>          low, medium, high, critical
  --group <id>             Grupo al que pertenece (repetible)
  --tags <a,b>  --owner <equipo>`,
    options: {
      parent: { type: 'string' },
      view: { type: 'string' },
      x: { type: 'string' },
      y: { type: 'string' },
      id: { type: 'string' },
      description: { type: 'string', short: 'd' },
      technology: { type: 'string', short: 't' },
      'container-type': { type: 'string' },
      engine: { type: 'string' },
      broker: { type: 'string' },
      topics: { type: 'string' },
      provider: { type: 'string' },
      region: { type: 'string' },
      role: { type: 'string' },
      'node-type': { type: 'string' },
      size: { type: 'string' },
      instances: { type: 'string' },
      account: { type: 'string' },
      'infra-type': { type: 'string' },
      of: { type: 'string' },
      replicas: { type: 'string' },
      addresses: { type: 'string' },
      resource: { type: 'string' },
      env: { type: 'string' },
      external: { type: 'boolean' },
      status: { type: 'string' },
      risk: { type: 'string' },
      group: { type: 'string', multiple: true },
      tags: { type: 'string' },
      owner: { type: 'string' },
    },
    run: async (io, pos, v) => {
      if (!(pos.length === 2 || (pos.length === 1 && v.of))) throw new UsageError('Uso: aegon add <kind> <nombre> (en una instancia alcanza con --of)');
      const x = num(v.x, 'x');
      const y = num(v.y, 'y');
      if ((x === undefined) !== (y === undefined)) throw new UsageError('Indicá --x y --y juntos');
      const ws = await openWorkspace(io, v);
      return add(
        io,
        ws,
        {
          kind: pos[0]!,
          name: pos[1] ?? '',
          id: str(v.id),
          parent: str(v.parent),
          view: str(v.view),
          at: x !== undefined && y !== undefined ? { x, y } : undefined,
          description: str(v.description),
          technology: list(v.technology as string | undefined),
          containerType: str(v['container-type']),
          engine: str(v.engine),
          broker: str(v.broker),
          topics: list(v.topics as string | undefined),
          provider: str(v.provider),
          region: str(v.region),
          role: str(v.role),
          nodeType: str(v['node-type']),
          size: str(v.size),
          instances: num(v.instances, 'instances'),
          account: str(v.account),
          infraType: str(v['infra-type']),
          of: str(v.of),
          replicas: num(v.replicas, 'replicas'),
          addresses: list(v.addresses as string | undefined),
          resource: str(v.resource),
          environments: list(v.env as string | undefined),
          external: !!v.external,
          status: oneOf<Status>(v.status, STATUSES, 'status'),
          risk: oneOf<Risk>(v.risk, RISKS, 'risk'),
          groups: Array.isArray(v.group) ? v.group : undefined,
          tags: list(v.tags as string | undefined),
          owner: str(v.owner),
        },
        { json: !!v.json },
      );
    },
  },
  connect: {
    usage: 'connect <desde> <hasta>',
    summary: 'Conecta dos elementos (una relación por par, como en C4)',
    help: `Opciones:
  -l, --label <texto>      Qué hace la relación ("Lee y escribe", "Publica pagos")
  -d, --description <txt>  Descripción larga
  -p, --protocols <a,b>    Protocolos del catálogo (https, rest, grpc, kafka, jdbc…)
  --ports <a,b>            Puertos de destino (443, 8080)
  --bidirectional          La comunicación va en ambos sentidos
  --status <estado>        planned, live, deprecated, retired

Si ya existe la relación al revés, se vuelve bidireccional; si ya existe, se completa con lo indicado.`,
    options: {
      label: { type: 'string', short: 'l' },
      description: { type: 'string', short: 'd' },
      protocols: { type: 'string', short: 'p' },
      ports: { type: 'string' },
      bidirectional: { type: 'boolean' },
      status: { type: 'string' },
    },
    run: async (io, pos, v) => {
      need(pos, 2, 'connect <desde> <hasta>');
      const ws = await openWorkspace(io, v);
      return connect(
        io,
        ws,
        {
          from: pos[0]!,
          to: pos[1]!,
          label: str(v.label),
          description: str(v.description),
          protocols: list(v.protocols as string | undefined),
          ports: list(v.ports as string | undefined)?.map((p) => {
            const n = Number(p.replace(/^:/, ''));
            if (!Number.isInteger(n)) throw new UsageError(`Puerto inválido: ${p}`);
            return n;
          }),
          direction: v.bidirectional ? 'bidirectional' : undefined,
          status: oneOf<Status>(v.status, STATUSES, 'status'),
        },
        { json: !!v.json },
      );
    },
  },
  layout: {
    usage: 'layout <lienzo>',
    summary: 'Ordena un lienzo automáticamente (ELK, como Shift+L en la app)',
    help: `Opciones:
  --ids <a,b,c>            Ordena solo estos elementos (dos o más)
  --fit-frames             No mueve nada: ajusta cada nodo o grupo a lo que contiene`,
    options: { ids: { type: 'string' }, 'fit-frames': { type: 'boolean' } },
    run: async (io, pos, v) => {
      need(pos, 1, 'layout <lienzo>');
      return layout(io, await openWorkspace(io, v), pos[0]!, { ids: list(v.ids as string | undefined), json: !!v.json, fitFrames: !!v['fit-frames'] });
    },
  },
  diff: {
    usage: 'diff [ref]',
    summary: 'Cambios del modelo respecto de un commit de git (HEAD por defecto)',
    help: 'Compara entidad por entidad (no línea por línea), igual que la pestaña Cambios de la app.',
    options: {},
    run: async (io, pos, v) => {
      if (pos.length > 1) throw new UsageError('Uso: aegon diff [ref]');
      return diff(io, await openWorkspace(io, v), pos[0] ?? 'HEAD', { json: !!v.json });
    },
  },
  export: {
    usage: 'export <formato>',
    summary: 'Exporta a mermaid, plantuml-c4, structurizr o json (o un flujo: export flow <id> <formato>)',
    help: `Opciones:
  --view <id>              Solo este lienzo (por defecto, todos)
  -o, --output <archivo>   Escribe en un archivo en vez de la salida estándar

Un flujo: aegon export flow <id> mermaid|text (diagrama de secuencia de Mermaid o texto numerado).`,
    options: { view: { type: 'string' }, output: { type: 'string', short: 'o' } },
    run: async (io, pos, v) => {
      if (pos[0] === 'flow') {
        if (pos.length !== 3) throw new UsageError('Uso: aegon export flow <id> <mermaid|text>');
        if (v.view) throw new UsageError('--view no aplica a un flujo');
        return exportFlowCommand(io, await openWorkspace(io, v), pos[1]!, pos[2], { output: str(v.output) });
      }
      if (pos.length !== 1) throw new UsageError('Uso: aegon export <mermaid|plantuml-c4|structurizr|json>');
      return exportCommand(io, await openWorkspace(io, v), pos[0], { view: str(v.view), output: str(v.output) });
    },
  },
  flows: {
    usage: 'flows',
    summary: 'Lista los flujos (recorridos paso a paso que la app reproduce como presentación)',
    help: `Opciones:
  --element <id>           Solo los flujos con algún paso sobre este elemento`,
    options: { element: { type: 'string' } },
    run: async (io, pos, v) => {
      need(pos, 0, 'flows');
      return flows(io, await openWorkspace(io, v), { element: str(v.element), json: !!v.json });
    },
  },
  flow: {
    usage: 'flow <id>',
    summary: 'Muestra un flujo con sus pasos numerados (1, 2, 5A.1…)',
    help: 'El flujo se indica por ID o por nombre. Con --json trae además el YAML del flujo y la relación de cada mensaje.',
    options: {},
    run: async (io, pos, v) => {
      need(pos, 1, 'flow <id>');
      return flow(io, await openWorkspace(io, v), pos[0]!, { json: !!v.json });
    },
  },
  comments: {
    usage: 'comments',
    summary: 'Lista los comentarios de los lienzos con sus respuestas',
    help: `Opciones:
  --open                   Solo los abiertos (sin resolver)
  --resolved               Solo los resueltos
  --view <id>              Solo los de este lienzo
  --element <id>           Solo los anclados a este elemento`,
    options: { open: { type: 'boolean' }, resolved: { type: 'boolean' }, view: { type: 'string' }, element: { type: 'string' } },
    run: async (io, pos, v) => {
      need(pos, 0, 'comments');
      if (v.open && v.resolved) throw new UsageError('Usá --open o --resolved, no los dos');
      const status = v.open ? 'open' : v.resolved ? 'resolved' : 'all';
      return comments(io, await openWorkspace(io, v), { status, view: str(v.view), element: str(v.element) }, { json: !!v.json });
    },
  },
};

function mainHelp(): string {
  const width = Math.max(...Object.values(COMMANDS).map((c) => c.usage.length));
  const lines = Object.values(COMMANDS).map((c) => `  ${c.usage.padEnd(width)}  ${c.summary}`);
  return `aegon ${VERSION} — arquitectura C4 como código

Uso: aegon <comando> [opciones]

Comandos:
${lines.join('\n')}

Opciones globales:
  -w, --workspace <carpeta>  Carpeta del workspace (por defecto, la actual o la más cercana con aegon.yaml)
  --json                     Salida en JSON (para scripts y agentes)
  -h, --help                 Ayuda (también: aegon <comando> --help)
  -v, --version              Versión

Los elementos se pueden indicar por ID o por nombre. Para agentes de IA: servidor MCP en
@aegon/mcp (ver docs/agents.md).
`;
}

function commandHelp(cmd: Command): string {
  return `Uso: aegon ${cmd.usage} [opciones]\n\n${cmd.summary}.\n\n${cmd.help}\n\nGlobales: -w/--workspace <carpeta>, --json, -h/--help\n`;
}

/** Separa el comando de las opciones globales que vengan antes (`aegon -w demo validate`). */
function splitCommand(argv: readonly string[]): { name: string | undefined; rest: string[] } {
  const takesValue = new Set(['-w', '--workspace']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('-')) return { name: arg, rest: [...argv.slice(0, i), ...argv.slice(i + 1)] };
    if (['-h', '--help', '-v', '--version'].includes(arg)) return { name: arg, rest: [] };
    if (takesValue.has(arg)) i++;
  }
  return { name: undefined, rest: [...argv] };
}

/** Errores de `util.parseArgs` en castellano. */
function argsError(err: unknown): UsageError {
  const e = err as { code?: string; message?: string };
  const option = /'([^' ]+)/.exec(e.message ?? '')?.[1] ?? '';
  if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return new UsageError(`Opción desconocida ${option}`);
  if (e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') return new UsageError(`Valor inválido o faltante para ${option}`);
  if (e.code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') return new UsageError(`Argumento inesperado ${option}`);
  return new UsageError(e.message ?? String(err));
}

/** Punto de entrada de la CLI. Devuelve el código de salida (0 ok, 1 falla, 2 uso incorrecto). */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const { name, rest } = splitCommand(argv);
  if (!name || name === '-h' || name === '--help' || name === 'help') {
    io.stdout(mainHelp());
    return 0;
  }
  if (name === '-v' || name === '--version' || name === 'version') {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  const cmd = COMMANDS[name];
  if (!cmd) {
    io.stderr(`Comando desconocido "${name}".\n\n${mainHelp()}`);
    return 2;
  }
  try {
    let parsed: { values: Values; positionals: string[] };
    try {
      parsed = parseArgs({ args: [...rest], options: { ...GLOBAL, ...cmd.options }, allowPositionals: true, strict: true }) as typeof parsed;
    } catch (err) {
      throw argsError(err);
    }
    if (parsed.values.help) {
      io.stdout(commandHelp(cmd));
      return 0;
    }
    return await cmd.run(io, parsed.positionals, parsed.values);
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`✗ ${err.message}\n  Mirá \`aegon ${name} --help\`.\n`);
      return 2;
    }
    if (err instanceof OpError || err instanceof WorkspaceError) {
      io.stderr(`✗ ${err.message} [${err.code}]\n`);
      return 1;
    }
    throw err;
  }
}
