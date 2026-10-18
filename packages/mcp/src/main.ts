#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { findWorkspaceRoot } from '@aegon/cli/workspace';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createAegonServer } from './server.ts';

/**
 * Servidor MCP de Aegon por stdio:
 *   node packages/mcp/src/main.ts --workspace <carpeta>
 * Sin --workspace usa AEGON_WORKSPACE o la carpeta actual (o la más cercana hacia arriba con
 * aegon.yaml). stdout es del protocolo: los mensajes para humanos van a stderr.
 */
const { values } = parseArgs({ options: { workspace: { type: 'string', short: 'w' } }, strict: true });
const explicit = values.workspace ?? process.env.AEGON_WORKSPACE;
const root = explicit ? resolve(explicit) : await findWorkspaceRoot(process.cwd());

const { server } = createAegonServer({ root });
await server.connect(new StdioServerTransport());
process.stderr.write(`aegon-mcp: workspace ${root}\n`);
