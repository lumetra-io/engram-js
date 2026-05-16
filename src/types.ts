export interface EngramClientOptions {
  /**
   * Engram API key. Looks like `eng_live_...`. Defaults to `process.env.ENGRAM_API_KEY`.
   */
  apiKey?: string;
  /**
   * API base URL. Defaults to `process.env.ENGRAM_BASE_URL` or `https://api.lumetra.io`.
   */
  baseUrl?: string;
  /**
   * Custom fetch implementation. Defaults to the global `fetch`.
   * Useful for proxying, retry middleware, or non-Node runtimes.
   */
  fetch?: typeof fetch;
  /**
   * Request timeout in milliseconds. Defaults to 30000 (30s).
   */
  timeoutMs?: number;
  /**
   * How many times to retry on a 429 (per-tenant concurrent-request cap).
   * Honors the server's `Retry-After` header, capped at 30s per sleep.
   * Defaults to 3. Set to 0 to disable retry and surface 429 as `EngramError`
   * on the first attempt.
   */
  maxRetriesOn429?: number;
}

export interface Bucket {
  id: string;
  name: string;
  description?: string | null;
  created_at: string;
  memory_count?: number;
}

export interface Memory {
  id: string;
  content: string;
  bucket_name?: string;
  created_at?: string;
  token_count?: number;
}

export interface StoreMemoryResult {
  id: string;
  bucket_name: string;
  token_count: number;
}

export interface ClearMemoriesResult {
  success: boolean;
  /** Number of memories actually deleted (server-reported). */
  cleared_count: number;
}

export interface RetrievedMemory {
  id?: string;
  content: string;
  score?: number;
  bucket?: string;
}

export interface QueryExplanation {
  retrieved_memories?: RetrievedMemory[];
  profile?: string | null;
  graph_facts?: string[];
}

export interface QueryUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface QueryResult {
  answer: string;
  explanation?: QueryExplanation;
  usage?: QueryUsage;
}

/**
 * One frame yielded by {@link EngramClient.queryStream}.
 *
 * The shape is discriminated by `type`:
 *   - `delta` frames carry an incremental piece of the answer in `content`.
 *   - `done` carries the final usage + (optional) explanation. Emitted
 *     exactly once at the end of the stream.
 */
export type QueryStreamEvent =
  | { type: 'delta'; content: string }
  | {
      type: 'done';
      usage?: QueryUsage;
      synthesis_usage?: unknown;
      explanation?: QueryExplanation;
    };

export interface QueryOptions {
  /**
   * Buckets to fuse across. Defaults to `['default']`.
   */
  buckets?: string[];
  /**
   * Maximum number of memories to retrieve. Defaults to 8.
   */
  topK?: number;
  /**
   * If true, server skips the synthesis LLM call and returns retrieval-only.
   * `answer` will be an empty string in that case. Defaults to false.
   */
  skipSynthesis?: boolean;
  /**
   * Whether to populate the `explanation` field. Defaults to true.
   */
  returnExplanation?: boolean;
}

export interface ListMemoriesOptions {
  limit?: number;
  offset?: number;
}

export interface ListMemoriesResult {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export class EngramError extends Error {
  override readonly name = 'EngramError';
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}
