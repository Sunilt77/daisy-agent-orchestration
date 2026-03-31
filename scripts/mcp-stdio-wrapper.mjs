#!/usr/bin/env node

import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const out = {
    command: '',
    argsJson: '[]',
    cwd: process.cwd(),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === '--command' && next) {
      out.command = next;
      i += 1;
      continue;
    }
    if (current === '--args-json' && next) {
      out.argsJson = next;
      i += 1;
      continue;
    }
    if (current === '--cwd' && next) {
      out.cwd = next;
      i += 1;
    }
  }

  return out;
}

function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function isJsonRpcLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && String(parsed.jsonrpc || '') === '2.0';
  } catch {
    return false;
  }
}

function createStdoutFilter(onPacketLine, onLogLine) {
  let pending = '';

  return (chunk) => {
    pending += toBuffer(chunk).toString('utf8');

    while (true) {
      const newlineIdx = pending.indexOf('\n');
      if (newlineIdx === -1) break;

      const lineWithNewline = pending.slice(0, newlineIdx + 1);
      pending = pending.slice(newlineIdx + 1);
      const line = lineWithNewline.replace(/\r?\n$/, '');
      if (!line.trim()) continue;

      if (isJsonRpcLine(line)) {
        onPacketLine(`${line}\n`);
      } else {
        onLogLine(lineWithNewline);
      }
    }
  };
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.command) {
  process.stderr.write('mcp-stdio-wrapper: missing --command\n');
  process.exit(1);
}

let childArgs = [];
try {
  const parsedArgs = JSON.parse(parsed.argsJson || '[]');
  if (!Array.isArray(parsedArgs)) throw new Error('args-json must decode to an array');
  childArgs = parsedArgs.map((value) => String(value));
} catch (error) {
  process.stderr.write(`mcp-stdio-wrapper: invalid --args-json (${error.message})\n`);
  process.exit(1);
}

const child = spawn(parsed.command, childArgs, {
  cwd: parsed.cwd || process.cwd(),
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});

process.stdin.on('data', (chunk) => {
  child.stdin.write(chunk);
});

process.stdin.on('end', () => {
  child.stdin.end();
});

const forwardStdout = createStdoutFilter(
  (packetLine) => process.stdout.write(packetLine),
  (logChunk) => process.stderr.write(logChunk),
);

child.stdout.on('data', forwardStdout);
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

child.on('error', (error) => {
  process.stderr.write(`mcp-stdio-wrapper child error: ${error.message}\n`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    process.stderr.write(`mcp-stdio-wrapper child terminated by signal ${signal}\n`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
