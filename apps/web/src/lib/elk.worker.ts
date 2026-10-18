/// <reference lib="webworker" />
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';

// ELK en su propio hilo: ordenar lienzos grandes no congela la interfaz.
const elk = new ELK();

self.onmessage = async (e: MessageEvent<{ id: number; graph: ElkNode }>) => {
  const { id, graph } = e.data;
  try {
    const result = await elk.layout(graph);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
