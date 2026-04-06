import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMcpRuntimeEnv,
  createMockPackageExecutable,
  resolveImportedMcpInvocation,
  resolveMcpPackagePrefix,
  resolveSpawnCommand,
  resolveSpawnInvocation,
} from '../src/server/mcpPackageRuntime';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('mcp package runtime helpers', () => {
  it('forces a writable npm HOME and cache even when the base HOME is invalid', () => {
    const env = buildMcpRuntimeEnv(
      { WHATSAPP_CLOUD_ACCESS_TOKEN: 'secret' },
      { HOME: '/nonexistent' } as NodeJS.ProcessEnv,
    );

    expect(env.HOME).not.toBe('/nonexistent');
    expect(String(env.NPM_CONFIG_CACHE || '')).toContain('agentic-orchestrator');
    expect(String(env.npm_config_cache || '')).toBe(String(env.NPM_CONFIG_CACHE || ''));
    expect(env['WHATSAPP_CLOUD_ACCESS_TOKEN']).toBe('secret');
  });

  it('resolves explicit MCP package prefixes and creates them on disk', async () => {
    const root = await makeTempDir('mcp-runtime-prefix-');
    const explicitPrefix = path.join(root, 'custom-prefix');

    const prefix = await resolveMcpPackagePrefix({
      env: { MCP_PACKAGE_PREFIX: explicitPrefix } as NodeJS.ProcessEnv,
      cwd: root,
    });

    expect(prefix).toBe(path.resolve(explicitPrefix));
  });

  it('rewrites npm-runner imports to a local prefix-backed npx invocation', async () => {
    const root = await makeTempDir('mcp-runtime-invocation-');
    const explicitPrefix = path.join(root, 'packages');
    const executablePath = await createMockPackageExecutable(
      path.resolve(explicitPrefix),
      '@daisyintel/whatsapp-cloud-mcp',
      'whatsapp-cloud-mcp',
      process.platform,
    );

    const invocation = await resolveImportedMcpInvocation({
      packageName: '@daisyintel/whatsapp-cloud-mcp',
      command: 'npx',
      args: ['-y', '@daisyintel/whatsapp-cloud-mcp', '--help'],
      env: { MCP_PACKAGE_PREFIX: explicitPrefix } as NodeJS.ProcessEnv,
      cwd: root,
    });

    expect(invocation.usedLocalPrefix).toBe(true);
    expect(invocation.command).toBe(executablePath);
    expect(invocation.args).toEqual(['--help']);
  });

  it('maps npm and npx to Windows command shims when needed', () => {
    expect(resolveSpawnCommand('npm', 'win32')).toBe('npm.cmd');
    expect(resolveSpawnCommand('npx', 'win32')).toBe('npx.cmd');
    expect(resolveSpawnCommand('npm.cmd', 'linux')).toBe('npm');
    expect(resolveSpawnCommand('npx.cmd', 'linux')).toBe('npx');
  });

  it('wraps Windows cmd launchers through cmd.exe for spawn compatibility', () => {
    expect(resolveSpawnInvocation('npm', ['-v'], 'win32', 'cmd.exe')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', '-v'],
    });
    expect(resolveSpawnInvocation('npx', ['-v'], 'win32', 'cmd.exe')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npx.cmd', '-v'],
    });
  });

  it('preserves explicit package binaries instead of forcing npx', async () => {
    const root = await makeTempDir('mcp-runtime-explicit-bin-');
    const explicitPrefix = path.join(root, 'packages');

    const invocation = await resolveImportedMcpInvocation({
      packageName: '@daisyintel/whatsapp-cloud-mcp',
      command: 'whatsapp-cloud-mcp',
      args: ['--help'],
      env: { MCP_PACKAGE_PREFIX: explicitPrefix } as NodeJS.ProcessEnv,
      cwd: root,
    });

    expect(invocation.usedLocalPrefix).toBe(false);
    expect(invocation.command).toBe('whatsapp-cloud-mcp');
    expect(invocation.args).toEqual(['--help']);
  });
});
