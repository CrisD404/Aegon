/// <reference lib="webworker" />
import { parseWorkspace, serializeWorkspace } from '@aegon/format-yaml';
import type { YamlRequest } from './yaml.ts';

// Parseo y serialización del YAML en su propio hilo: con miles de archivos tardan cientos de ms.
self.onmessage = (e: MessageEvent<YamlRequest & { id: number }>) => {
  const msg = e.data;
  try {
    const result = msg.type === 'parse' ? parseWorkspace(msg.files, msg.options) : serializeWorkspace(msg.model, msg.options);
    self.postMessage({ id: msg.id, result });
  } catch (error) {
    self.postMessage({ id: msg.id, error: error instanceof Error ? error.message : String(error) });
  }
};
