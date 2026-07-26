/**
 * installCli tests — wrapper generation and best-effort installation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWrapper, installCliWrapper, isCliInstalled } from '../../src/setup/installCli.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'omnimind-cli-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('buildWrapper', () => {
  it('builds a POSIX wrapper that execs node with cli.js', () => {
    const wrapper = buildWrapper('/usr/bin/node', '/app/dist/cli.js');
    expect(wrapper).toBe('#!/bin/sh\nexec "/usr/bin/node" "/app/dist/cli.js" "$@"\n');
  });
});

describe('installCliWrapper', () => {
  it('writes an executable wrapper into the first writable target', () => {
    const result = installCliWrapper({
      nodePath: '/usr/bin/node',
      cliPath: '/app/dist/cli.js',
      targets: [join(dir, 'bin')],
    });
    expect(result.ok).toBe(true);
    expect(result.path).toBe(join(dir, 'bin', 'omnimind'));
    expect(readFileSync(result.path!, 'utf8')).toContain('/app/dist/cli.js');
    expect(statSync(result.path!).mode & 0o111).not.toBe(0);
  });

  it('creates missing target directories', () => {
    const result = installCliWrapper({
      nodePath: '/usr/bin/node',
      cliPath: '/app/dist/cli.js',
      targets: [join(dir, 'deep', 'nested', 'bin')],
    });
    expect(result.ok).toBe(true);
  });

  it('falls back to the next target when the first is not writable', () => {
    const blocked = join(dir, 'blocked');
    // A file (not a dir) at the target path forces mkdir/access failure
    writeFileSync(blocked, 'x');
    const result = installCliWrapper({
      nodePath: '/usr/bin/node',
      cliPath: '/app/dist/cli.js',
      targets: [blocked, join(dir, 'bin')],
    });
    expect(result.ok).toBe(true);
    expect(result.path).toBe(join(dir, 'bin', 'omnimind'));
  });

  it('reports an error when no target is writable', () => {
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, 'x');
    const result = installCliWrapper({
      nodePath: '/usr/bin/node',
      cliPath: '/app/dist/cli.js',
      targets: [blocked],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('npm install -g omnimind');
  });

  it('is not supported on Windows', () => {
    const result = installCliWrapper({
      nodePath: 'C:\\node\\node.exe',
      cliPath: 'C:\\app\\cli.js',
      platform: 'win32',
      targets: [join(dir, 'bin')],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not supported on Windows');
  });
});

describe('isCliInstalled', () => {
  it('returns null when no wrapper exists', () => {
    expect(isCliInstalled({ targets: [join(dir, 'bin')] })).toBeNull();
  });

  it('returns the wrapper path when present', () => {
    installCliWrapper({
      nodePath: '/usr/bin/node',
      cliPath: '/app/dist/cli.js',
      targets: [join(dir, 'bin')],
    });
    expect(isCliInstalled({ targets: [join(dir, 'bin')] })).toBe(join(dir, 'bin', 'omnimind'));
  });
});
