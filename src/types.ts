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
   * Request timeout in milliseconds for buffered (non-streaming) calls.
   * Defaults to 30000 (30s).
   */
  timeoutMs?: number;
  /**
   * Timeout in milliseconds for `queryStream` calls. Streaming responses
   * can sit in the prep phase (retrieval + extractor pass) for 5–15s
   * before the first synthesis token arrives, so the buffered 30s
   * default would leave no headroom for the streamed body. Defaults to
   * 300000 (5 min). Use a higher value for very large synthesis bodies.
   */
  streamTimeoutMs?: number;
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
  /**
   * Mirror of `name`. The server emits both so callers iterating both
   * `listBuckets` and `storeMemory` responses can use one field name.
   * Prefer `name` in new code.
   */
  bucket_name?: string;
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

export type StoreStatus = 'stored' | 'merged';

export type MergeReason =
  | 'content_hash'
  | 'embedding_similarity'
  | 'conflict_keep_existing'
  | 'concurrent_insert_race';

export interface StoreMemoryResult {
  id: string;
  /**
   * Alias for `id` — older API docs / older SDKs referenced this name.
   * Always present; prefer `id` in new code.
   */
  memory_id?: string;
  bucket_name: string;
  token_count: number;
  /**
   * `"stored"` for fresh writes, `"merged"` when the server collapsed
   * this write into a pre-existing memory via dedup. Always present.
   */
  status?: StoreStatus;
  /** Present only when `status === "merged"`. ID of the canonical memory the write was absorbed into. */
  deduped_into?: string;
  /** Present only when `status === "merged"`. Similarity score in [0.0, 1.0] (1.0 for content-hash matches). */
  similarity_score?: number;
  /** Present only when `status === "merged"`. Reason for the merge. */
  merge_reason?: MergeReason;
}

/**
 * Dedup policy passed to `storeMemory`. The server's default (currently
 * `"loose"`) applies when omitted.
 *
 * - `"off"` — store every write as a new memory; useful for templated
 *   time-series ingest where structurally similar rows carry unique
 *   values and would otherwise collapse.
 * - `"loose"` — merge writes at similarity ≥ 0.95 (default).
 * - `"strict"` — only merge near-identical content (≥ 0.99).
 */
export type DedupPolicy = 'off' | 'loose' | 'strict';

export interface ClearMemoriesResult {
  success: boolean;
  /** Number of memories actually deleted (server-reported). */
  cleared_count: number;
}

export interface RetrievedMemory {
  memory_id: string;
  bucket_id?: string;
  bucket_name?: string;
  content: string;
  /** Raw similarity score from semantic retrieval, in [0, 1]. */
  raw_score?: number;
  /** Per-bucket weight applied during fusion. */
  weight?: number;
  /** `raw_score * weight`, used for ranking. */
  weighted_score?: number;
  metadata?: Record<string, unknown>;
}

/**
 * One graph fact returned alongside the retrieved memories. Each fact is
 * linked back to the source memory it was extracted from via `memory_id`,
 * so a caller can render "answer cited from memory X".
 */
export interface GraphFact {
  subject: string;
  predicate: string;
  object: string;
  /**
   * ID of the memory this fact was extracted from. Cross-reference against
   * `retrieved_memories[].memory_id` to surface the citing memory. May be
   * absent for edges that predate the per-edge memory_id plumbing.
   */
  memory_id?: string;
  bucket_id?: string;
  bucket_name?: string;
  /** Hop distance from the seed entity. 0 = direct fact, 1+ = transitive. */
  depth?: number;
  weight?: number;
  /** ISO-8601 timestamp from the source memory, for temporal supersession. */
  timestamp?: string | null;
}

export interface EntityMatch {
  entity: string;
  bucket_name?: string;
  score?: number;
}

export interface QueryExplanation {
  retrieved_memories?: RetrievedMemory[];
  graph_facts?: GraphFact[];
  entity_matches?: EntityMatch[];
  /** Token count of the retrieval context fed to the synthesis pass. */
  context_tokens?: number;
  /** Legacy single-bucket profile, kept for backward compatibility. */
  profile?: string | null;
  /**
   * Multi-bucket profile snapshots, keyed by bucket name. Present when the
   * query spanned more than one bucket and each had an installed profiler.
   */
  profiles?: Record<string, string | null>;
}

export interface QueryUsage {
  prompt_tokens?: number;
  /**
   * Canonical server field. Older versions of this SDK exposed this as
   * `completion_tokens`; the server has always emitted `output_tokens`.
   */
  output_tokens?: number;
  total_tokens?: number;
}

/**
 * Profile snapshot returned by `getProfile` / `regenerateProfile`.
 *
 * `profile` is the canonical text prepended to recall. The remaining fields
 * describe *which* snapshot is being returned and the state of the bucket's
 * profiler agent. All fields beyond `profile` are optional so older servers
 * that only return `{ profile }` still type-check.
 */
export interface ProfileResult {
  /** UUID of the bucket this profile belongs to. */
  bucket_id?: string;
  /**
   * `'ready'` when a snapshot exists, `'pending'` when the profiler is
   * running its first tick, `'not_installed'` when no profiler agent
   * is installed on the bucket.
   */
  status?: 'ready' | 'pending' | 'not_installed';
  /** ISO-8601 timestamp of the most recent profile snapshot. */
  updated_at?: string;
  /** Number of memories present at the time the profile was generated. */
  n_memories_at_gen?: number;
  /** Canonical profile text. `null` when no snapshot has been produced yet. */
  profile: string | null;
  /** Identifier of the agent/source that produced the snapshot. */
  source?: string;
}

export interface QueryResult {
  answer: string;
  /**
   * Parsed JSON when the request set `returnFormat: 'json'`. Present
   * only on JSON queries — the parsed value (object / array / scalar)
   * on success, or `null` when the model returned malformed JSON.
   */
  answer_json?: unknown;
  /**
   * Top-level count of retrieved memories. Equivalent to
   * `result.explanation?.retrieved_memories.length` but present even
   * when `returnExplanation` is false.
   */
  memories_found?: number;
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
   * Maximum number of memories to retrieve per bucket. Defaults to 8.
   * Used as the fallback K when `topKPerBucket` doesn't cover a bucket.
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
  /**
   * Cap synthesis output tokens. Default is the server's (currently
   * 8192). Lower for agent loops or cost control.
   */
  maxTokens?: number;
  /**
   * Drop retrieved chunks whose **raw cosine similarity** (the
   * underlying embedding score) is below this. Acts as a floor over
   * the server's adaptive threshold. Useful when you specifically
   * want a precision floor on the embedding signal.
   */
  minSimilarityThreshold?: number;
  /**
   * Drop retrieved chunks whose **weighted_score** (the post-RRF
   * score surfaced in `explanation.retrieved_memories`) is below
   * this. This is the score you see in responses — most callers
   * want this rather than `minSimilarityThreshold` because the
   * scales match.
   */
  minWeightedScore?: number;
  /**
   * Per-bucket retrieval depth. `number` for a uniform value across
   * all buckets; an object for explicit per-bucket K (e.g.
   * `{ edgar_AAPL: 20, prices_AAPL: 4 }`). Missing buckets fall back
   * to `topK`. Lets callers express "deep retrieval on this one,
   * shallow on the others."
   */
  topKPerBucket?: number | Record<string, number>;
  /**
   * `'prose'` (default) or `'json'`. When `'json'`, the server asks
   * the synthesizer for JSON output and returns the parsed value
   * under `result.answer_json` alongside the raw `result.answer`.
   */
  returnFormat?: 'prose' | 'json';
  /**
   * Optional JSON Schema describing the desired output shape. Included
   * in the prompt to guide the model. Best-effort — validate
   * client-side if you need strict enforcement.
   */
  responseSchema?: Record<string, unknown>;
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
