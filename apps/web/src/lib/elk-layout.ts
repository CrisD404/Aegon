import type { ELK as ElkApi, ElkNode } from 'elkjs/lib/elk-api';
import { elkArrangeOp as coreElkArrangeOp, type ElkGraphNode, type Id, type Model, type Op } from '@aegon/core';

let elk: ElkApi | null = null;

/**
 * Corre ELK en su propio Web Worker (el script de ELK, con el protocolo de `elk-api`), o en el
 * hilo actual donde no hay workers (tests). `elk.bundled.js` no sirve dentro de un worker propio:
 * detecta el contexto de worker y se registra como el script de ELK en vez de exportarse.
 */
export async function runElk(graph: ElkGraphNode): Promise<ElkGraphNode> {
  if (typeof Worker === 'undefined') {
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    return (await new ELK().layout(graph as ElkNode)) as ElkGraphNode;
  }
  if (!elk) {
    const [{ default: ELK }, { default: workerUrl }] = await Promise.all([import('elkjs/lib/elk-api.js'), import('elkjs/lib/elk-worker.min.js?url')]);
    elk = new ELK({ workerFactory: () => new Worker(workerUrl) });
  }
  return (await elk.layout(graph as ElkNode)) as ElkGraphNode;
}

/** Op que ordena un lienzo (o una selección) con ELK (el grafo lo arma el núcleo, igual que en el MCP). */
export function elkArrangeOp(model: Model, viewId: Id, ids?: readonly Id[]): Promise<Op | null> {
  return coreElkArrangeOp(model, viewId, runElk, ids);
}
