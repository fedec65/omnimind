export interface LlmEnableFlagArgs {
  provider: 'ollama' | 'lmstudio';
  baseUrl?: string | undefined;
  model?: string | undefined;
  timeoutMs?: string | undefined;
}

function parseFlag(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const v = args[i + 1];
  return v === undefined ? null : v;
}

export function parseLlmEnableArgs(args: string[]): LlmEnableFlagArgs | null {
  const provider = parseFlag(args, '--provider');
  if (provider !== 'ollama' && provider !== 'lmstudio') return null;
  const baseUrl = parseFlag(args, '--base-url');
  const model = parseFlag(args, '--model');
  const timeoutMs = parseFlag(args, '--timeout-ms');
  return {
    provider,
    ...(baseUrl !== null ? { baseUrl } : {}),
    ...(model !== null ? { model } : {}),
    ...(timeoutMs !== null ? { timeoutMs } : {}),
  };
}