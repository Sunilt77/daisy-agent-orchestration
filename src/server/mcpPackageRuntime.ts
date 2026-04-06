import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type ResolveMcpPackagePrefixOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

type ResolveImportedMcpInvocationOptions = {
  packageName?: string;
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

function normalizeNpmPackageName(value: string) {
  return String(value || '').trim().toLowerCase();
}

function resolveRuntimeRoot(env: NodeJS.ProcessEnv = process.env) {
  const explicitRoot = String(env.MCP_RUNTIME_ROOT || '').trim();
  if (explicitRoot) return path.resolve(explicitRoot);
  return path.resolve(
    String(env.TMPDIR || env.TEMP || env.TMP || os.tmpdir()),
    'agentic-orchestrator',
  );
}

function resolveRuntimePaths(env: NodeJS.ProcessEnv = process.env) {
  const root = resolveRuntimeRoot(env);
  return {
    root,
    home: path.join(root, '.home'),
    npmCache: path.join(root, '.npm'),
    xdgCacheHome: path.join(root, '.cache'),
    fallbackPackagePrefix: path.join(root, '.mcp-packages'),
  };
}

async function ensureWritableDirectory(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
  await access(dirPath, fsConstants.W_OK);
  return dirPath;
}

async function tryWritableDirectory(dirPath: string) {
  try {
    await ensureWritableDirectory(dirPath);
    return true;
  } catch {
    return false;
  }
}

let cachedDefaultPrefix: Promise<string> | null = null;

export async function resolveMcpPackagePrefix(options: ResolveMcpPackagePrefixOptions = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const explicitPrefix = String(env.MCP_PACKAGE_PREFIX || '').trim();
  const useCache = !options.env && !options.cwd && !explicitPrefix;

  if (useCache && cachedDefaultPrefix) {
    return await cachedDefaultPrefix;
  }

  const resolver = async () => {
    const { fallbackPackagePrefix } = resolveRuntimePaths(env);
    if (explicitPrefix) {
      return await ensureWritableDirectory(path.resolve(explicitPrefix));
    }

    const workspacePrefix = path.resolve(cwd, '.mcp-packages');
    if (await tryWritableDirectory(workspacePrefix)) {
      return workspacePrefix;
    }

    return await ensureWritableDirectory(fallbackPackagePrefix);
  };

  if (useCache) {
    cachedDefaultPrefix = resolver();
    return await cachedDefaultPrefix;
  }

  return await resolver();
}

export async function ensureMcpRuntimeDirectories(env: NodeJS.ProcessEnv = process.env) {
  const runtimePaths = resolveRuntimePaths(env);
  const prefix = await resolveMcpPackagePrefix({ env });
  await Promise.all([
    ensureWritableDirectory(runtimePaths.home),
    ensureWritableDirectory(runtimePaths.npmCache),
    ensureWritableDirectory(runtimePaths.xdgCacheHome),
    ensureWritableDirectory(prefix),
  ]);
  return {
    ...runtimePaths,
    prefix,
  };
}

export function buildMcpRuntimeEnv(
  extraEnv: Record<string, string> = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
) {
  const runtimePaths = resolveRuntimePaths(baseEnv);
  return {
    ...baseEnv,
    ...extraEnv,
    HOME: runtimePaths.home,
    USERPROFILE: String(baseEnv.USERPROFILE || runtimePaths.home),
    NPM_CONFIG_CACHE: runtimePaths.npmCache,
    npm_config_cache: runtimePaths.npmCache,
    XDG_CACHE_HOME: runtimePaths.xdgCacheHome,
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    npm_config_update_notifier: 'false',
    NPM_CONFIG_FUND: 'false',
    npm_config_fund: 'false',
    NPM_CONFIG_AUDIT: 'false',
    npm_config_audit: 'false',
  };
}

function basenameLower(value: string) {
  return path.basename(String(value || '').trim()).toLowerCase();
}

function packageNameSegments(packageName: string) {
  return String(packageName || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function packageBaseName(packageName: string) {
  const segments = packageNameSegments(packageName);
  return segments.length ? segments[segments.length - 1] : String(packageName || '').trim();
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveSpawnCommand(command: string, platform = process.platform) {
  const trimmed = String(command || '').trim();
  const normalized = trimmed.toLowerCase();
  if (!trimmed) return trimmed;

  if (platform === 'win32') {
    if (normalized === 'npm' || normalized === 'npm.cmd') return 'npm.cmd';
    if (normalized === 'npx' || normalized === 'npx.cmd') return 'npx.cmd';
    return trimmed;
  }

  if (normalized === 'npm.cmd') return 'npm';
  if (normalized === 'npx.cmd') return 'npx';
  return trimmed;
}

export function resolveSpawnInvocation(
  command: string,
  args: string[] = [],
  platform = process.platform,
  comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
) {
  const resolvedCommand = resolveSpawnCommand(command, platform);
  const resolvedArgs = Array.isArray(args) ? args.map((value) => String(value)) : [];

  if (platform === 'win32' && /\.(cmd|bat)$/i.test(resolvedCommand)) {
    return {
      command: comspec,
      args: ['/d', '/s', '/c', resolvedCommand, ...resolvedArgs],
    };
  }

  return {
    command: resolvedCommand,
    args: resolvedArgs,
  };
}

function extractNpxPackageExecution(args: string[], packageName: string) {
  const normalizedPackage = normalizeNpmPackageName(packageName);
  const sourceArgs = Array.isArray(args) ? args.map((value) => String(value)) : [];
  const packageIndex = sourceArgs.findIndex((value) => normalizeNpmPackageName(value) === normalizedPackage);
  const formatResult = (extras: string[]) => {
    const explicitBin = extras[0] && !String(extras[0]).startsWith('-') ? String(extras[0]) : '';
    return {
      explicitBin,
      trailingArgs: explicitBin ? extras.slice(1) : extras,
    };
  };
  if (packageIndex >= 0) {
    return formatResult(sourceArgs.slice(packageIndex + 1));
  }

  const extras: string[] = [];
  for (let index = 0; index < sourceArgs.length; index += 1) {
    const current = sourceArgs[index];
    const normalized = current.toLowerCase();
    if (current === '-y' || current === '--yes') continue;
    if (current === '--prefix' || current === '-p') {
      index += 1;
      continue;
    }
    if (normalized.startsWith('--prefix=')) continue;
    extras.push(current);
  }
  return formatResult(extras);
}

async function resolveInstalledPackageExecutable(
  prefix: string,
  packageName: string,
  requestedBin = '',
  platform = process.platform,
) {
  const packageDir = path.join(prefix, 'node_modules', ...packageNameSegments(packageName));
  const manifestPath = path.join(packageDir, 'package.json');
  let manifest: any = null;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    return null;
  }

  const requested = basenameLower(requestedBin);
  const defaultBin = basenameLower(packageBaseName(String(manifest?.name || packageName)));
  let binName = '';
  const binField = manifest?.bin;

  if (typeof binField === 'string') {
    binName = requested || defaultBin;
  } else if (binField && typeof binField === 'object' && !Array.isArray(binField)) {
    const entries = Object.keys(binField).map((key) => String(key).trim()).filter(Boolean);
    const matchByName = (needle: string) => entries.find((entry) => basenameLower(entry) === needle) || '';
    binName = (requested && matchByName(requested))
      || (defaultBin && matchByName(defaultBin))
      || (entries.length === 1 ? entries[0] : '');
  }

  if (!binName) return null;

  const candidates = platform === 'win32'
    ? [
        path.join(prefix, 'node_modules', '.bin', `${binName}.cmd`),
        path.join(prefix, 'node_modules', '.bin', binName),
      ]
    : [
        path.join(prefix, 'node_modules', '.bin', binName),
        path.join(prefix, 'node_modules', '.bin', `${binName}.cmd`),
      ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export async function createMockPackageExecutable(
  prefix: string,
  packageName: string,
  binName: string,
  platform = process.platform,
) {
  const packageDir = path.join(prefix, 'node_modules', ...packageNameSegments(packageName));
  const binDir = path.join(prefix, 'node_modules', '.bin');
  await mkdir(packageDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageName, version: '0.0.0', bin: { [binName]: 'bin.js' } }, null, 2),
    'utf8',
  );
  const executablePath = platform === 'win32'
    ? path.join(binDir, `${binName}.cmd`)
    : path.join(binDir, binName);
  await writeFile(executablePath, platform === 'win32' ? '@echo off\r\n' : '#!/usr/bin/env node\n', 'utf8');
  return executablePath;
}

export async function resolveImportedMcpInvocation(options: ResolveImportedMcpInvocationOptions) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const packageName = normalizeNpmPackageName(String(options.packageName || ''));
  const command = String(options.command || '').trim();
  const args = Array.isArray(options.args) ? options.args.map((value) => String(value)) : [];

  if (!packageName) {
    return {
      command,
      args,
      packageName,
      prefix: null as string | null,
      usedLocalPrefix: false,
    };
  }

  const normalizedCommand = basenameLower(command);
  const usesNpmRunner =
    !normalizedCommand ||
    normalizedCommand === 'npx' ||
    normalizedCommand === 'npx.cmd' ||
    normalizedCommand === 'npm' ||
    normalizedCommand === 'npm.cmd';

  const prefix = await resolveMcpPackagePrefix({ env, cwd });
  if (usesNpmRunner) {
    const execution = extractNpxPackageExecution(args, packageName);
    const executable = await resolveInstalledPackageExecutable(prefix, packageName, execution.explicitBin);
    if (executable) {
      return {
        command: executable,
        args: execution.trailingArgs,
        packageName,
        prefix,
        usedLocalPrefix: true,
      };
    }
    const binHint = execution.explicitBin || packageBaseName(packageName);
    return {
      command: normalizedCommand.endsWith('.cmd') ? 'npx.cmd' : 'npx',
      args: ['--yes', '--prefix', prefix, '--package', packageName, binHint, ...execution.trailingArgs],
      packageName,
      prefix,
      usedLocalPrefix: true,
    };
  }

  const localExecutable = await resolveInstalledPackageExecutable(prefix, packageName, command);
  if (localExecutable) {
    return {
      command: localExecutable,
      args,
      packageName,
      prefix,
      usedLocalPrefix: true,
    };
  }

  return {
    command,
    args,
    packageName,
    prefix: null as string | null,
    usedLocalPrefix: false,
  };
}
