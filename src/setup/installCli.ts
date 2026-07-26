/**
 * installCli — best-effort installation of the `omnimind` shell command.
 *
 * Writes a tiny wrapper script that execs the current Node binary against
 * the bundled cli.js, so desktop-app users get the CLI without npm.
 * POSIX only (macOS/Linux); on Windows callers should show the manual
 * npm instructions instead.
 *
 * Targets /usr/local/bin first, falling back to ~/.local/bin. Pure
 * functions with injectable paths for testability.
 */

import { writeFileSync, chmodSync, mkdirSync, existsSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface InstallCliResult {
  readonly ok: boolean;
  readonly path?: string | undefined;
  readonly error?: string | undefined;
}

/** The wrapper script content: exec the given node against the given cli.js */
export function buildWrapper(nodePath: string, cliPath: string): string {
  return `#!/bin/sh\nexec "${nodePath}" "${cliPath}" "$@"\n`;
}

/**
 * Install the wrapper into the first writable target directory.
 * Returns the path written, or an error describing what to do manually.
 */
export function installCliWrapper(opts: {
  nodePath: string;
  cliPath: string;
  platform?: NodeJS.Platform | undefined;
  home?: string | undefined;
  /** Target dirs override (tests) */
  targets?: readonly string[] | undefined;
}): InstallCliResult {
  const platform = opts.platform ?? process.platform;
  if (platform === 'win32') {
    return {
      ok: false,
      error: 'Automatic CLI install is not supported on Windows. Use: npm install -g omnimind',
    };
  }

  const home = opts.home ?? homedir();
  const targets = opts.targets ?? ['/usr/local/bin', join(home, '.local', 'bin')];

  for (const dir of targets) {
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
      const target = join(dir, 'omnimind');
      writeFileSync(target, buildWrapper(opts.nodePath, opts.cliPath), { mode: 0o755 });
      chmodSync(target, 0o755);
      return { ok: true, path: target };
    } catch {
      // try next target
    }
  }

  return {
    ok: false,
    error: `Could not write to ${targets.join(' or ')}. Install manually with: npm install -g omnimind`,
  };
}

/** Whether an `omnimind` wrapper already exists in any target directory */
export function isCliInstalled(opts: {
  home?: string | undefined;
  targets?: readonly string[] | undefined;
}): string | null {
  const home = opts.home ?? homedir();
  const targets = opts.targets ?? ['/usr/local/bin', join(home, '.local', 'bin')];
  for (const dir of targets) {
    const target = join(dir, 'omnimind');
    if (existsSync(target)) return target;
  }
  return null;
}
