import {
  EngramError,
  type Bucket,
  type EngramClientOptions,
  type ListMemoriesOptions,
  type ListMemoriesResult,
  type QueryOptions,
  type QueryResult,
  type StoreMemoryResult,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.lumetra.io';
const DEFAULT_TIMEOUT_MS = 30_000;

export class EngramClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: EngramClientOptions = {}) {
    const apiKey =
      options.apiKey ??
      (typeof process !== 'undefined' ? process.env?.ENGRAM_API_KEY : undefined) ??
      '';
    if (!apiKey) {
      throw new Error(
        'EngramClient: apiKey is required. Pass it explicitly or set ENGRAM_API_KEY in your environment.',
      );
    }
    const baseUrl =
      options.baseUrl ??
      (typeof process !== 'undefined' ? process.env?.ENGRAM_BASE_URL : undefined) ??
      DEFAULT_BASE_URL;

    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'EngramClient: no fetch implementation available. Use Node 18+, or pass options.fetch.',
      );
    }
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: unknown; query?: Record<string, string | number | undefined> } = {
      method: 'GET',
    },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const detail =
        parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed
          ? (parsed as { error: unknown }).error
          : parsed;
      throw new EngramError(
        `Engram API ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')}`,
        res.status,
        parsed,
      );
    }

    return parsed as T;
  }

  // ---------- Memories ----------

  async storeMemory(content: string, bucket: string = 'default'): Promise<StoreMemoryResult> {
    return this.request<StoreMemoryResult>(
      `/v1/buckets/${encodeURIComponent(bucket)}/memories`,
      { method: 'POST', body: { content } },
    );
  }

  async storeMemories(
    contents: string[],
    bucket: string = 'default',
  ): Promise<{ memories: StoreMemoryResult[] }> {
    // Defensively unwrap: depending on server version the batch endpoint
    // returns either { memories: [...] } or a bare array. Normalize to the
    // wrapped shape so callers don't have to switch on it.
    const result = await this.request<{ memories: StoreMemoryResult[] } | StoreMemoryResult[]>(
      `/v1/buckets/${encodeURIComponent(bucket)}/memories`,
      { method: 'POST', body: { memories: contents.map((content) => ({ content })) } },
    );
    return Array.isArray(result) ? { memories: result } : result;
  }

  async listMemories(
    bucket: string = 'default',
    options: ListMemoriesOptions = {},
  ): Promise<ListMemoriesResult> {
    return this.request<ListMemoriesResult>(
      `/v1/buckets/${encodeURIComponent(bucket)}/memories`,
      {
        method: 'GET',
        query: { limit: options.limit ?? 20, offset: options.offset ?? 0 },
      },
    );
  }

  async deleteMemory(memoryId: string, bucket: string = 'default'): Promise<void> {
    await this.request<unknown>(
      `/v1/buckets/${encodeURIComponent(bucket)}/memories/${encodeURIComponent(memoryId)}`,
      { method: 'DELETE' },
    );
  }

  async clearMemories(bucket: string): Promise<void> {
    await this.request<unknown>(
      `/v1/buckets/${encodeURIComponent(bucket)}/memories`,
      { method: 'DELETE' },
    );
  }

  // ---------- Query ----------

  async query(question: string, options: QueryOptions = {}): Promise<QueryResult> {
    const buckets = options.buckets ?? ['default'];
    return this.request<QueryResult>('/v1/query', {
      method: 'POST',
      body: {
        query: question,
        buckets,
        options: {
          top_k: options.topK ?? 8,
          return_explanation: options.returnExplanation ?? true,
          skip_synthesis: options.skipSynthesis ?? false,
        },
      },
    });
  }

  // ---------- Buckets ----------

  async listBuckets(): Promise<Bucket[]> {
    const result = await this.request<{ buckets: Bucket[] } | Bucket[]>(`/v1/buckets`, {
      method: 'GET',
    });
    return Array.isArray(result) ? result : result.buckets;
  }

  async createBucket(name: string, description?: string): Promise<Bucket> {
    return this.request<Bucket>('/v1/buckets', {
      method: 'POST',
      body: { name, description },
    });
  }

  async deleteBucket(bucket: string): Promise<void> {
    await this.request<unknown>(`/v1/buckets/${encodeURIComponent(bucket)}`, {
      method: 'DELETE',
    });
  }

  // ---------- Profile ----------

  async getProfile(bucket: string = 'default'): Promise<{ profile: string | null }> {
    return this.request<{ profile: string | null }>(
      `/v1/buckets/${encodeURIComponent(bucket)}/profile`,
      { method: 'GET' },
    );
  }

  async regenerateProfile(bucket: string = 'default'): Promise<{ profile: string | null }> {
    return this.request<{ profile: string | null }>(
      `/v1/buckets/${encodeURIComponent(bucket)}/profile/regenerate`,
      { method: 'POST' },
    );
  }
}
