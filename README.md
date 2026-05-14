# engram-js

Official TypeScript client for [Engram](https://lumetra.io) — durable, explainable memory for AI agents.

- Zero runtime dependencies (uses built-in `fetch`).
- ESM + CommonJS, full `.d.ts` typings.
- Node 18+, Bun, Deno, edge runtimes.

## Install

```bash
npm install engram-js
# or
yarn add engram-js
# or
pnpm add engram-js
```

## Quickstart

```ts
import { EngramClient } from 'engram-js';

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
- `storeMemory(content, bucket?)` — store a single fact
- `storeMemories(contents[], bucket?)` — batched store
- `listMemories(bucket?, { limit?, offset? })` — paginated list
- `deleteMemory(memoryId, bucket?)` — delete one memory
- `clearMemories(bucket)` — delete every memory in a bucket

### Query
- `query(question, { buckets?, topK?, skipSynthesis?, returnExplanation? })`
  - `buckets` fuses across multiple buckets in one call
  - `skipSynthesis: true` returns retrieval-only — no server-side LLM call
  - response shape: `{ answer, explanation: { retrieved_memories, profile, graph_facts }, usage }`

### Buckets
- `listBuckets()` — all buckets in your tenant
- `createBucket(name, description?)`
- `deleteBucket(bucket)`

### Profile
- `getProfile(bucket?)` — the canonical profile prepended to recall
- `regenerateProfile(bucket?)` — rebuild from current memories

### Errors

All HTTP failures throw `EngramError`:

```ts
import { EngramError } from 'engram-js';

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
