#!/usr/bin/env node
/**
 * Omnimind CLI
 * 
 * Command-line interface for memory management.
 * 
 * Commands:
 *   init          Initialize Omnimind in current directory
 *   store <text>  Store a new memory
 *   search <query> Search memories
 *   predict       Get predictions for current context
 *   status        Show system status
 *   mine <path>   Import files/conversations into memory
 *   wipe          Clear all memories (with confirmation)
 * 
 * Usage:
 *   omnimind init
 *   omnimind store "User wants dark mode" --wing preferences
 *   omnimind search "dark mode preferences"
 *   omnimind status
 */

import { Omnimind } from './index.js';
import { homedir } from 'os';
import { join, resolve } from 'path';

const commands: Record<string, (args: string[]) => Promise<void>> = {
  init,
  store,
  search,
  predict,
  activity,
  inject,
  status,
  mine,
  wipe,
  bus: busCommand,
};

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    process.exit(0);
  }

  if (cmd === '--version' || cmd === '-v') {
    const pkg = JSON.parse(
      (await import('fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
    );
    console.log(pkg.version);
    process.exit(0);
  }

  const handler = commands[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    printHelp();
    process.exit(1);
  }

  try {
    await handler(args);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
Omnimind — Proactive memory for LLMs

Usage: omnimind <command> [options]

Commands:
  init                    Initialize Omnimind (~/.omnimind/)
  store <text>            Store a memory
    --wing <name>         Category (required)
    --room <name>         Sub-category (optional)
    --tool <name>         Source tool (optional)
    --pin                 Prevent aging (optional)
  
  search <query>          Search memories
    --limit <n>           Max results (default: 10)
    --wing <name>         Filter by wing
    --room <name>         Filter by room
  
  predict                 Predict relevant memories
    --project <path>      Project directory
    --branch <name>       Git branch
    --file <path>         Current file
  
  activity                Show recent activity and pattern stats
  
  inject                  Print formatted context injection string
  
  status                  Show system status
  
  mine <path>             Import conversations/files
    --format <type>       Format: claude, chatgpt, markdown
    --wing <name>         Target wing
  
  wipe                    Clear all memories (!)
  
  bus status              Show connected tools and subscriptions
  bus sync [tool-id]      Pull updates from specific tool
  bus conflicts           List unresolved conflicts

Examples:
  omnimind init
  omnimind store "Use GraphQL not REST" --wing project-alpha --room architecture
  omnimind search "API architecture decision"
  omnimind status
`);
}

// ─── Command Implementations ──────────────────────────────────────

async function init(): Promise<void> {
  const omni = await Omnimind.create();
  const stats = await omni.stats();
  if (stats.ok) {
    console.log(`✓ Omnimind initialized at ~/.omnimind/`);
    console.log(`  Database: ${join(homedir(), '.omnimind', 'memory.db')}`);
    console.log(`  Model cache: ${join(homedir(), '.omnimind', 'models')}`);
    console.log(`  Memories: ${stats.value.totalMemories}`);
  }
  omni.close();
}

async function store(args: string[]): Promise<void> {
  const text = args[0];
  if (!text) {
    console.error('Usage: omnimind store <text> --wing <name>');
    process.exit(1);
  }

  const wing = parseFlag(args, '--wing');
  if (!wing) {
    console.error('Error: --wing is required');
    process.exit(1);
  }

  const omni = await Omnimind.create();
  const room = parseFlag(args, '--room');
  const sourceTool = parseFlag(args, '--tool');
  const result = await omni.store(text, {
    wing,
    ...(room !== null ? { room } : {}),
    ...(sourceTool !== null ? { sourceTool } : {}),
    pinned: args.includes('--pin') ? true : undefined,
  });

  if (result.ok) {
    console.log(`✓ Stored memory ${result.value.id.substring(0, 8)} in ${wing}`);
  } else {
    console.error(`Error: ${result.error.message}`);
  }

  omni.close();
}

async function search(args: string[]): Promise<void> {
  const query = args[0];
  if (!query) {
    console.error('Usage: omnimind search <query>');
    process.exit(1);
  }

  const omni = await Omnimind.create();
  const wing = parseFlag(args, '--wing');
  const room = parseFlag(args, '--room');
  const searchOpts: import('./core/types.js').SearchOptions = {
    limit: parseInt(parseFlag(args, '--limit') ?? '10', 10),
    ...(wing !== null ? { wing } : {}),
    ...(room !== null ? { room } : {}),
  };
  const result = await omni.search(query, searchOpts);

  if (result.ok) {
    if (result.value.length === 0) {
      console.log('No memories found.');
    } else {
      console.log(`Found ${result.value.length} memories:\n`);
      for (const [i, r] of result.value.entries()) {
        const layerNames = ['verbatim', 'compressed', 'concept', 'wisdom'];
        console.log(`${i + 1}. [${r.memory.wing}/${r.memory.room}] ${layerNames[r.memory.layer]} (score: ${r.score.toFixed(3)})`);
        console.log(`   ${r.memory.content.substring(0, 200)}${r.memory.content.length > 200 ? '...' : ''}\n`);
      }
    }
  } else {
    console.error(`Error: ${result.error.message}`);
  }

  omni.close();
}

async function predict(args: string[]): Promise<void> {
  const omni = await Omnimind.create();
  const result = await omni.predict({
    projectPath: parseFlag(args, '--project') ?? process.cwd(),
    gitBranch: parseFlag(args, '--branch') ?? 'main',
    currentFile: parseFlag(args, '--file') ?? 'unknown',
    recentTools: [],
    recentWings: [],
    recentRooms: [],
  });

  if (result.ok) {
    if (result.value.length === 0) {
      console.log('No predictions for current context.');
    } else {
      console.log(`Predictions (${result.value.length}):\n`);
      for (const pred of result.value) {
        const mem = await omni.get(pred.memoryId);
        if (mem.ok && mem.value) {
          console.log(`  • ${mem.value.content.substring(0, 200)} (${(pred.confidence * 100).toFixed(0)}%)`);
        }
      }
    }
  } else {
    console.error(`Error: ${result.error.message}`);
  }

  omni.close();
}

async function activity(): Promise<void> {
  const omni = await Omnimind.create();
  const stats = omni.getActivityStats();
  const predStats = omni.predictor.getStats();

  console.log('Activity Tracker');
  console.log('================');
  console.log(`Running: ${stats.isRunning}`);
  console.log(`Recent files tracked: ${stats.recentFiles}`);
  console.log(`Recent tools tracked: ${stats.recentTools}`);
  console.log('');
  console.log('Predictor Patterns');
  console.log('==================');
  console.log(`Total patterns: ${predStats.totalPatterns}`);
  console.log(`Unique contexts: ${predStats.uniqueContexts}`);

  omni.close();
}

async function inject(): Promise<void> {
  const omni = await Omnimind.create();
  const result = await omni.getContextInjection();

  if (result.ok) {
    if (result.value) {
      console.log(result.value);
    } else {
      console.log('No context injection available.');
    }
  } else {
    console.error(`Error: ${result.error.message}`);
  }

  omni.close();
}

async function status(): Promise<void> {
  const omni = await Omnimind.create();
  const result = await omni.stats();

  if (result.ok) {
    const s = result.value;
    const layerNames = ['Verbatim', 'Compressed', 'Concept', 'Wisdom'];

    console.log('Omnimind Status');
    console.log('================');
    console.log(`Total memories: ${s.totalMemories}`);
    console.log('By layer:');
    for (const [layer, count] of Object.entries(s.memoriesByLayer)) {
      console.log(`  ${layerNames[Number(layer)]}: ${count}`);
    }
    console.log(`Database size: ${(s.databaseSizeBytes / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.error(`Error: ${result.error.message}`);
  }

  omni.close();
}

async function mine(args: string[]): Promise<void> {
  const path = args[0];
  if (!path) {
    console.error('Usage: omnimind mine <path> --wing <name> --format <type>');
    process.exit(1);
  }

  const wing = parseFlag(args, '--wing');
  if (!wing) {
    console.error('Error: --wing is required');
    process.exit(1);
  }

  const { readFileSync, existsSync, statSync } = await import('fs');
  const targetPath = resolve(path);

  if (!existsSync(targetPath)) {
    console.error(`Error: path does not exist: ${targetPath}`);
    process.exit(1);
  }

  const omni = await Omnimind.create();
  const format = parseFlag(args, '--format') ?? 'markdown';
  let count = 0;

  try {
    const stats = statSync(targetPath);
    if (stats.isFile()) {
      const content = readFileSync(targetPath, 'utf-8');
      const chunks = format === 'markdown'
        ? content.split(/\n#{1,3}\s+/).filter(c => c.trim().length > 20)
        : [content];
      for (const chunk of chunks.slice(0, 50)) {
        const result = await omni.store(chunk.trim(), { wing });
        if (result.ok) count++;
      }
    } else {
      console.error('Error: mining directories is not yet supported');
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error mining file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log(`Mined ${count} memories from ${targetPath} into ${wing}`);
  omni.close();
}

async function busCommand(args: string[]): Promise<void> {
  const subcmd = args[0];
  if (!subcmd || subcmd === '--help') {
    console.log(`
Bus commands:
  bus status          Show connected adapters and bus statistics
  bus sync [tool]     Sync missed events from a tool (default: all)
  bus conflicts       List unresolved conflicts
`);
    return;
  }

  const omni = await Omnimind.create();

  switch (subcmd) {
    case 'status': {
      const stats = omni.bus.getStats();
      console.log('Memory Bus Status');
      console.log('=================');
      console.log(`Adapters: ${stats.adapterCount}`);
      console.log(`Subscriptions: ${stats.subscriptionCount}`);
      console.log(`Events published: ${stats.eventsPublished}`);
      console.log(`Events routed: ${stats.eventsRouted}`);
      console.log(`Conflicts: ${stats.conflictsDetected} detected, ${stats.conflictsResolved} resolved`);
      console.log(`Dead letter: ${stats.deadLetterCount}`);
      if (Object.keys(stats.vectorClock).length > 0) {
        console.log('Vector clock:');
        for (const [tool, count] of Object.entries(stats.vectorClock)) {
          console.log(`  ${tool}: ${count}`);
        }
      }
      break;
    }
    case 'sync': {
      const toolId = args[1] ?? 'cli-client';
      const result = await omni.sync(toolId);
      if (result.ok) {
        console.log(`Synced ${result.value.length} events`);
        for (const event of result.value) {
          console.log(`  [${event.sourceTool}] ${event.payload.wing ?? 'general'}: ${event.payload.content?.substring(0, 100) ?? ''}`);
        }
      } else {
        console.error(`Error: ${result.error.message}`);
      }
      break;
    }
    case 'conflicts': {
      const report = omni.getConflictReport();
      if (report.ok && report.value.length === 0) {
        console.log('No unresolved conflicts.');
      } else if (report.ok) {
        console.log(`Unresolved conflicts: ${report.value.length}`);
        for (const c of report.value) {
          console.log(`  ${c.winningEvent.id} vs ${c.losingEvent.id}: ${c.explanation}`);
        }
      } else {
        console.error(`Error: ${report.error.message}`);
      }
      break;
    }
    default:
      console.error(`Unknown bus command: ${subcmd}`);
      process.exit(1);
  }

  omni.close();
}

async function wipe(): Promise<void> {
  console.error('This will delete ALL memories. This action cannot be undone.');
  console.error('To confirm, run: omnimind wipe --yes-i-am-sure');

  if (!process.argv.includes('--yes-i-am-sure')) {
    process.exit(1);
  }

  const dbPath = join(homedir(), '.omnimind', 'memory.db');
  try {
    const { unlinkSync, existsSync } = await import('fs');
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
    console.log('All memories cleared.');
  } catch (error) {
    console.error(`Error clearing memories: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// ─── Utilities ────────────────────────────────────────────────────

function parseFlag(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1] ?? null;
  }
  return null;
}

main();
