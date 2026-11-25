#!/usr/bin/env node
// Ejemplo de la skill de Aegon: el ciclo completo sobre un sistema ficticio ("Tienda Online").
// Contexto, contenedores, despliegue de un ambiente, un flujo, orden automático y la compuerta.
//
//   node examples/tienda-online.mjs <carpeta-nueva>
//
// Los comandos son los mismos que corrés a mano; lo que la CLI no hace (lienzos de detalle,
// ambientes y flujos) se escribe como YAML, igual que acá. Los nombres son inventados.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/aegon.mjs', import.meta.url));
const dir = resolve(process.argv[2] ?? 'tienda-online');
const L2 = 'tienda-online-containers';
const DEPLOY = 'tienda-online-despliegue-prod';

/** Corre un comando de la CLI sobre el workspace y corta ante un código de salida distinto de 0. */
function aegon(...args) {
  console.log(`\n$ aegon ${args.map((a) => (/[\s¿?]/.test(a) ? `"${a}"` : a)).join(' ')}`);
  const run = spawnSync(process.execPath, [cli, ...args, ...(args[0] === 'init' ? [] : ['-w', dir])], { stdio: 'inherit' });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

/** Escribe un YAML a mano dentro del workspace. */
function write(file, text) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), text);
  console.log(`\n+ ${file} (escrito a mano)`);
}

// 1. Workspace: manifiesto, AGENTS.md y el lienzo "contexto" (L1).
aegon('init', dir, '--name', 'Tienda Online');

// 2. Contexto: personas, el sistema y los sistemas externos.
aegon('add', 'actor', 'Cliente', '--role', 'Compra productos', '--external', '--view', 'contexto');
aegon('add', 'system', 'Tienda Online', '-d', 'Venta de productos por internet', '--view', 'contexto');
aegon('add', 'system', 'Pasarela de pagos', '--external', '-d', 'Cobra con tarjeta', '--view', 'contexto');
aegon('add', 'system', 'Correo transaccional', '--external', '-d', 'Envía los avisos al cliente', '--view', 'contexto');

// 3. Lienzo de contenedores (L2): la CLI no crea lienzos. Los vecinos que ya existen se ubican
//    en 0,0 y `layout` los ordena al final.
write(
  `views/${L2}.yaml`,
  `id: ${L2}
name: Tienda Online · Contenedores
level: 2
scope: tienda-online
nodes:
  cliente: { x: 0, y: 0 }
  pasarela-de-pagos: { x: 0, y: 0 }
  correo-transaccional: { x: 0, y: 0 }
`,
);

// 4. Contenedores: con --view en un L2 quedan ubicados y con el sistema como padre.
aegon('add', 'container', 'Web', '--view', L2, '-t', 'react,typescript', '--container-type', 'web', '-d', 'Catálogo y carrito');
aegon('add', 'container', 'API de pedidos', '--view', L2, '-t', 'nodejs', '--container-type', 'api', '--risk', 'high');
aegon('add', 'container', 'Notificador', '--view', L2, '-t', 'go', '--container-type', 'worker');
aegon('add', 'store', 'Pedidos DB', '--view', L2, '--engine', 'postgresql');
aegon('add', 'bus', 'Eventos de pedidos', '--view', L2, '--broker', 'kafka', '--topics', 'pedidos.creados');

// 5. Relaciones entre los elementos más específicos; el contexto deriva las suyas.
aegon('connect', 'cliente', 'web', '-l', 'Compra', '-p', 'https');
aegon('connect', 'web', 'api-de-pedidos', '-l', 'Crea y consulta pedidos', '-p', 'rest,https');
aegon('connect', 'api-de-pedidos', 'pedidos-db', '-l', 'Lee y escribe pedidos', '-p', 'jdbc');
aegon('connect', 'api-de-pedidos', 'pasarela-de-pagos', '-l', 'Cobra el pedido', '-p', 'https');
aegon('connect', 'api-de-pedidos', 'eventos-de-pedidos', '-l', 'Publica pedidos.creados', '-p', 'kafka');
aegon('connect', 'notificador', 'eventos-de-pedidos', '-l', 'Consume pedidos.creados', '-p', 'kafka');
aegon('connect', 'notificador', 'correo-transaccional', '-l', 'Envía la confirmación', '-p', 'smtp');

// 6. Despliegue de producción: el ambiente va en el manifiesto y el lienzo se escribe a mano.
appendFileSync(join(dir, 'aegon.yaml'), 'environments:\n  - { id: prod, name: Producción }\n');
console.log('\n+ aegon.yaml: environments (editado a mano)');
write(
  `views/${DEPLOY}.yaml`,
  `id: ${DEPLOY}
name: Tienda Online · Despliegue Producción
level: deployment
scope: tienda-online
environment: prod
nodes:
  cliente: { x: 0, y: 0 }
`,
);
const prod = ['--view', DEPLOY, '--env', 'prod'];
aegon('add', 'node', 'Nube', '--node-type', 'cloud', '--region', 'us-east-1', ...prod);
aegon('add', 'node', 'Clúster', '--node-type', 'cluster', '--parent', 'nube', ...prod);
aegon('add', 'infra', 'Balanceador', '--infra-type', 'load-balancer', '--parent', 'nube', '--addresses', 'tienda.example.com', ...prod);
aegon('add', 'instance', '--of', 'web', '--parent', 'cluster', '--replicas', '2', ...prod);
aegon('add', 'instance', '--of', 'api-de-pedidos', '--parent', 'cluster', '--replicas', '3', ...prod);
aegon('add', 'instance', '--of', 'notificador', '--parent', 'cluster', ...prod);
aegon('add', 'instance', '--of', 'pedidos-db', '--parent', 'nube', ...prod);
aegon('add', 'instance', '--of', 'eventos-de-pedidos', '--parent', 'nube', ...prod);
// Camino de red: relaciones comunes entre el actor, la infraestructura y la instancia.
aegon('connect', 'cliente', 'balanceador', '-l', 'Navega', '-p', 'https', '--ports', '443');
aegon('connect', 'balanceador', 'web-prod', '-p', 'https');

// 7. Un flujo: pasos numerados sobre elementos que ya están conectados.
write(
  'flows/compra.yaml',
  `id: compra
name: Compra de un producto
description: Desde que el cliente confirma el carrito hasta que recibe el aviso.
view: ${L2}
steps:
  - { type: message, from: cliente, to: web, title: Confirma el carrito }
  - { type: message, from: web, to: api-de-pedidos, title: POST /pedidos }
  - { type: message, from: api-de-pedidos, to: pasarela-de-pagos, title: Cobra el pedido }
  - type: paths
    mode: alternate
    title: ¿Se aprobó el pago?
    paths:
      - name: Aprobado
        steps:
          - { type: message, from: api-de-pedidos, to: pedidos-db, title: Guarda el pedido }
          - { type: message, from: api-de-pedidos, to: eventos-de-pedidos, title: Publica pedidos.creados }
          - { type: process, element: notificador, title: Arma el correo de confirmación }
          - { type: message, from: notificador, to: correo-transaccional, title: Envía la confirmación }
      - name: Rechazado
        steps:
          - { type: note, title: La web muestra el rechazo y el pedido no se guarda }
`,
);

// 8. Orden automático de cada lienzo, cuando ya están todas las relaciones.
for (const view of ['contexto', L2, DEPLOY]) aegon('layout', view);

// 9. La compuerta: los dos tienen que salir con 0 (si no, este script corta acá).
aegon('validate', '--strict', '--info');
aegon('lint');

// 10. Vista rápida para el chat o un README.
aegon('flow', 'compra');
aegon('export', 'mermaid', '--view', L2);
console.log(`\nWorkspace listo en ${dir}`);
