import {
  EngramError,
  type Bucket,
  type ClearMemoriesResult,
  type EngramClientOptions,
  type ListMemoriesOptions,
  type ListMemoriesResult,
  type QueryOptions,
  type QueryResult,
  type QueryStreamEvent,
  type StoreMemoryResult,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.lumetra.io';
const DEFAULT_TIMEOUT_MS = 30_000;
const SDK_VERSION = '0.3.0';
const USER_AGENT = `engram-js/${SDK_VERSION}`;

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
          'User-Agent': USER_AGENT,
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

  async clearMemories(bucket: string): Promise<ClearMemoriesResult> {
    const res = await this.request<ClearMemoriesResult>(
      `/v1/buckets/${encodeURIComponent(bucket)}/memories`,
      { method: 'DELETE' },
    );
    // Defensive default: older servers / proxies may strip the body. The
    // contract surface is {success, cleared_count}; if the server stayed
    // silent we still return the same shape so callers can rely on it.
    return res ?? { success: true, cleared_count: 0 };
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

  /**
   * Streaming variant of {@link query}. Returns an async-iterable that
   * yields {@link QueryStreamEvent} frames as the server produces them:
   *
   *   for await (const ev of engram.queryStream('...')) {
   *     if (ev.type === 'delta') process.stdout.write(ev.content);
   *     else if (ev.type === 'done') console.log(ev.usage);
   *   }
   *
   * Break out of the loop to abort the request (the underlying
   * AbortController is wired up to the fetch call).
   */
  queryStream(question: string, options: QueryOptions = {}): AsyncIterable<QueryStreamEvent> {
    const buckets = options.buckets ?? ['default'];
    const body = {
      query: question,
      buckets,
      stream: true,
      options: {
        top_k: options.topK ?? 8,
        return_explanation: options.returnExplanation ?? true,
        skip_synthesis: options.skipSynthesis ?? false,
      },
    };
    const url = `${this.baseUrl}/v1/query`;
    const apiKey = this.apiKey;
    const fetchImpl = this.fetchImpl;
    const timeoutMs = this.timeoutMs;

    return {
      [Symbol.asyncIterator]: () => {
        const controller = new AbortController();
        // The timeout caps total wall-clock for the stream. Set generously
        // because synthesis can run 10–25s before the first byte even with
        // streaming on slow paths; clamp to the user's configured timeout.
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let responsePromise: Promise<Response> | null = null;
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let done = false;
        const queue: QueryStreamEvent[] = [];
        let pendingError: unknown = null;

        const ensureStarted = async (): Promise<void> => {
          if (responsePromise) return;
          responsePromise = fetchImpl(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
              'User-Agent': USER_AGENT,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const res = await responsePromise;
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            let parsed: unknown = text;
            try {
              parsed = text ? JSON.parse(text) : text;
            } catch {
              /* keep raw text */
            }
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
          if (!res.body) {
            throw new EngramError('Engram API: streaming response has no body', res.status, null);
          }
          reader = res.body.getReader();
        };

        const drainBuffer = (): void => {
          // SSE frames are separated by a blank line ('\n\n'). Each frame
          // is one or more 'field: value' lines. We only care about
          // 'data:' lines for this stream.
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLines: string[] = [];
            for (const rawLine of frame.split('\n')) {
              const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
              if (line.startsWith('data: ')) {
                dataLines.push(line.slice(6));
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5));
              }
            }
            if (dataLines.length === 0) continue;
            const payloadStr = dataLines.join('\n');
            if (payloadStr === '[DONE]') {
              done = true;
              return;
            }
            let payload: unknown;
            try {
              payload = JSON.parse(payloadStr);
            } catch {
              // Malformed frame — skip rather than corrupt the stream.
              continue;
            }
            if (payload && typeof payload === 'object') {
              const obj = payload as Record<string, unknown>;
              if (obj.error) {
                pendingError = new EngramError(String(obj.error), 0, obj);
                done = true;
                return;
              }
              // OpenAI-style delta chunk
              const choices = obj.choices as Array<{ delta?: { content?: string } }> | undefined;
              if (Array.isArray(choices) && choices.length > 0) {
                const delta = choices[0]?.delta?.content;
                if (typeof delta === 'string' && delta.length > 0) {
                  queue.push({ type: 'delta', content: delta });
                }
                continue;
              }
              // Final usage / explanation frame (no 'choices' key).
              queue.push({ type: 'done', ...(obj as Omit<Extract<QueryStreamEvent, { type: 'done' }>, 'type'>) });
            }
          }
        };

        return {
          next: async (): Promise<IteratorResult<QueryStreamEvent>> => {
            try {
              await ensureStarted();
            } catch (err) {
              clearTimeout(timer);
              throw err;
            }
            while (queue.length === 0 && !done) {
              if (!reader) {
                clearTimeout(timer);
                throw new EngramError('Engram API: stream reader missing', 0, null);
              }
              const chunk = await reader.read();
              if (chunk.done) {
                // Flush whatever's left in the buffer (some servers don't
                // terminate with a trailing blank line).
                if (buffer.length > 0) {
                  buffer += '\n\n';
                  drainBuffer();
                }
                done = true;
                break;
              }
              buffer += decoder.decode(chunk.value, { stream: true });
              drainBuffer();
            }
            if (queue.length > 0) {
              return { value: queue.shift() as QueryStreamEvent, done: false };
            }
            clearTimeout(timer);
            if (pendingError) throw pendingError;
            return { value: undefined as unknown as QueryStreamEvent, done: true };
          },
          return: async (): Promise<IteratorResult<QueryStreamEvent>> => {
            // Caller broke out of the for-await loop — cancel the upstream
            // request so we're not holding the connection open.
            clearTimeout(timer);
            controller.abort();
            try {
              await reader?.cancel();
            } catch {
              /* ignored */
            }
            return { value: undefined as unknown as QueryStreamEvent, done: true };
          },
        };
      },
    };
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
