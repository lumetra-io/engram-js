# @lumetra/engram

Official TypeScript client for [Engram](https://lumetra.io) — durable, explainable memory for AI agents.

- Zero runtime dependencies (uses built-in `fetch`).
- ESM + CommonJS, full `.d.ts` typings.
- Node 18+, Bun, Deno, edge runtimes.

## Install

```bash
npm install @lumetra/engram
# or
yarn add @lumetra/engram
# or
pnpm add @lumetra/engram
```

## Quickstart

```ts
import { EngramClient } from '@lumetra/engram';

const engram = new EngramClient({
  apiKey: process.env.ENGRAM_API_KEY, // or set ENGRAM_API_KEY and omit
});

// Store a fact
await engram.storeMemory('User prefers dark mode.', 'user-123');

// Recall — returns a synthesized answer plus the memories that contributed
const result = await engram.query('What are this user\'s UI preferences?', {
  buckets: ['user-123'],
});

console.log(result.answer);
console.log(result.explanation?.retrieved_memories);
```

### Automatic 429 retry

The Engram API enforces a per-tenant concurrent-request cap and returns `429 Too Many Requests` with a `Retry-After` header when you exceed it. The client honors that header automatically (up to `maxRetriesOn429` attempts, default 3, capped at 30s per sleep) so bursty workloads don't fail on the first contention spike. Pass `maxRetriesOn429: 0` in the constructor to opt out and surface 429 as `EngramError` immediately.

## Configuration

```ts
new EngramClient({
  apiKey: 'eng_live_...',           // or ENGRAM_API_KEY env var
  baseUrl: 'https://api.lumetra.io', // or ENGRAM_BASE_URL env var
  timeoutMs: 30_000,                 // optional, default 30s
  fetch: customFetch,                // optional, defaults to globalThis.fetch
});
```

> **BYOK reminder.** Engram is bring-your-own-key end-to-end. Configure an OpenAI / Anthropic / Groq / Together / Fireworks key on the [Lumetra portal](https://lumetra.io/models) before your first call, or `storeMemory` / `query` will return HTTP 412.

## API surface

### Memories
- `storeMemory(content, bucket?, { dedup? })` — store a single fact. `bucket` defaults to `"default"`. `dedup` is `"off" | "loose" | "strict"`; omit to use the server's default policy. See [Dedup](#dedup) below.
- `storeMemories(contents[], bucket?)` — batched store. `bucket` defaults to `"default"`.
- `listMemories(bucket?, { limit?, offset? })` — paginated list (`limit` defaults to 20, `offset` to 0).
- `deleteMemory(memoryId, bucket?)` — delete one memory. `bucket` defaults to `"default"`.
- `clearMemories(bucket)` — delete every memory in a bucket. **No default — explicit bucket required** (prevents accidental wipes).

### Query
- `query(question, { buckets?, topK?, skipSynthesis?, returnExplanation? })`
  - `buckets` fuses across multiple buckets in one call. Defaults to `["default"]`.
  - `topK` defaults to `8`.
  - `skipSynthesis: true` returns retrieval-only — no server-side LLM call. Defaults to `false`.
  - `returnExplanation` defaults to `true`.
  - response shape: `{ answer, explanation: { retrieved_memories, profile, graph_facts }, usage }`
- `queryStream(question, options?)` — same args, returns an `AsyncIterable<QueryStreamEvent>` that streams the answer

## Dedup

The server runs a similarity check before storing. By default (`"loose"`, similarity ≥ 0.95) it collapses near-duplicate writes into the existing memory so re-ingesting the same source doesn't bloat the bucket. For most narrative content this is what you want.

For templated time-series content (financial filings, daily metrics, log rows) where rows are structurally similar but each carries unique values, the default collapses real data. Use `dedup: 'off'` to disable.

Every response now includes a `status` field. When `status === 'merged'`, the write was absorbed into an existing memory and three extra fields are present:

```ts
const r = await engram.storeMemory('Acme Q1 revenue: $245M', 'finance');
if (r.status === 'merged') {
  console.log(`merged into ${r.deduped_into} (${r.merge_reason}, sim=${r.similarity_score?.toFixed(3)})`);
}
```

`merge_reason` is one of `content_hash`, `embedding_similarity`, `conflict_keep_existing`, `concurrent_insert_race`.

Opt out for time-series ingest:

```ts
for (const row of monthlyPrices) {
  await engram.storeMemory(row, 'prices_AAPL', { dedup: 'off' });
}
```

`'strict'` is a middle ground — only collapses near-identical content (≥ 0.99).

## Streaming

For broad questions, synthesis can take 10–25 seconds. `queryStream` yields the answer incrementally so you can render it as it's produced instead of waiting for the full response:

```ts
for await (const event of engram.queryStream('Summarize what I worked on this week', { buckets: ['work'] })) {
  if (event.type === 'delta') {
    process.stdout.write(event.content);
  } else if (event.type === 'done') {
    console.log();
    console.log(`Used ${event.usage?.output_tokens} tokens`);
  }
}
```

Two frame types (discriminated by `type`):

```ts
type QueryStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; usage?: QueryUsage; synthesis_usage?: unknown; explanation?: QueryExplanation };
```

- `delta` frames carry incremental synthesis output, in order. Zero or more.
- `done` is emitted exactly once at the end with final usage and explanation.

Break out of the `for await` loop to abort the request — the iterator's `return()` cancels the upstream fetch.

### Buckets
- `listBuckets()` — all buckets in your tenant
- `createBucket(name, description?)`
- `deleteBucket(bucket)` — **No default — explicit bucket required** (prevents accidental wipes).

### Profile
- `getProfile(bucket?)` — the canonical profile prepended to recall. `bucket` defaults to `"default"`.
- `regenerateProfile(bucket?)` — rebuild from current memories. `bucket` defaults to `"default"`.

### Errors

All HTTP failures throw `EngramError`:

```ts
import { EngramError } from '@lumetra/engram';

try {
  await engram.storeMemory('...');
} catch (err) {
  if (err instanceof EngramError) {
    console.error(err.status, err.body);
  }
}
```

## Development

```bash
npm install
npm run typecheck
npm run build       # emits dist/
npm run dev         # watch mode
```

`npm run prepublishOnly` runs typecheck + clean build automatically when publishing.

## License

[MIT](LICENSE) — Copyright (c) 2026 Lumetra.
