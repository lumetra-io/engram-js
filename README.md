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
- `storeMemory(content, bucket?)` — store a single fact. `bucket` defaults to `"default"`.
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
