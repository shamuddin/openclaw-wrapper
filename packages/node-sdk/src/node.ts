import type { NodeTypeDescriptor } from '@openclaw-wrapper/schemas';
import type { Static, TSchema } from '@sinclair/typebox';

export interface NodeLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ExecutionContext {
  runId: string;
  flowId: string;
  logger: NodeLogger;
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Base class for flow node implementations.
 *
 * `TConfig` is the shape of the per-instance config stored in `GraphNode.data`.
 * `TResult` is the shape of the value produced on success.
 *
 * Graph-level connectivity (inputs/outputs as ports) is declared via `descriptor`.
 */
export abstract class FlowNode<TConfig extends TSchema, TResult extends TSchema> {
  abstract readonly descriptor: Omit<NodeTypeDescriptor, 'configSchema'>;
  abstract readonly configSchema: TConfig;
  abstract readonly resultSchema: TResult;

  abstract execute(config: Static<TConfig>, ctx: ExecutionContext): Promise<Static<TResult>>;

  describe(): NodeTypeDescriptor {
    return { ...this.descriptor, configSchema: this.configSchema };
  }

  validate(_config: Static<TConfig>): ValidationResult {
    return { ok: true };
  }
}
