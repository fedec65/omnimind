/**
 * Tagged union of local-LLM failures. Distinct from Error because typed
 * callers pattern-match on `kind` rather than catching/reading `.message`.
 */
export type LLMError =
  | { kind: 'unavailable'; cause: string }
  | { kind: 'response'; status: number; body: string }
  | { kind: 'config'; reason: string }
  | { kind: 'aborted' };

/** Human-readable message for an LLMError, used by CLI/MCP/server output. */
export function llmErrorMessage(e: LLMError): string {
  switch (e.kind) {
    case 'unavailable':
      return e.cause;
    case 'response':
      return `LLM responded ${e.status}: ${e.body}`;
    case 'config':
      return e.reason;
    case 'aborted':
      return 'LLM request aborted';
  }
}
