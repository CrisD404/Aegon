#!/usr/bin/env node
import { run } from './cli.ts';
import { nodeIo } from './io.ts';

process.exitCode = await run(process.argv.slice(2), nodeIo);
