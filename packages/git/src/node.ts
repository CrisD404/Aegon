import { spawn } from 'node:child_process';
import type { GitBackend, GitResult } from './types.ts';

/** Ejecuta el `git` del sistema con Node (CLI, servidor MCP y tests). */
export class NodeGitBackend implements GitBackend {
  constructor(readonly cwd: string) {}

  run(args: string[], opts: { input?: string } = {}): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: this.cwd,
        // Nunca quedarse esperando credenciales por consola.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
        windowsHide: true,
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (d: Buffer) => out.push(d));
      child.stderr.on('data', (d: Buffer) => err.push(d));
      child.on('error', reject);
      child.on('close', (code) =>
        resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }),
      );
      if (opts.input !== undefined) child.stdin.end(opts.input);
      else child.stdin.end();
    });
  }
}
