# Engram + Vercel AI SDK

A minimal Next.js App Router example that wires [`@lumetra/engram`](https://www.npmjs.com/package/@lumetra/engram) into a [Vercel AI SDK](https://sdk.vercel.ai) chat route. The model gets three tools — `store_memory`, `query_memory`, `list_memories` — and a system prompt that tells it when to call them.

Full writeup: [lumetra.io/engram-vercel-ai-sdk](https://lumetra.io/engram-vercel-ai-sdk).

## What's here

```
examples/vercel-ai-sdk/
├── lib/
│   ├── engram.ts      # one-line client init
│   ├── tools.ts       # store_memory, query_memory, list_memories
│   └── prompt.ts      # the system prompt that makes the agent actually use them
├── app/api/chat/
│   └── route.ts       # streamText handler wiring it together
└── .env.example
```

## Install into an existing Next.js app

```bash
npm install ai @ai-sdk/openai zod @lumetra/engram
```

Copy the four files into your project at the matching paths, copy `.env.example` to `.env.local` and fill in two keys:

- `OPENAI_API_KEY` — the chat model
- `ENGRAM_API_KEY` — your Engram tenant key (get one at [lumetra.io](https://lumetra.io))

> **BYOK reminder.** Engram is bring-your-own-key end-to-end. Configure an OpenAI / Anthropic / Groq / Together / Fireworks key on the [Lumetra portal](https://lumetra.io/models) before your first call, or `storeMemory` / `query` will return HTTP 412. The example handles 412 gracefully — the model gets a clear error string and tells the user that memory isn't configured rather than hallucinating a confirmation.

## What's not here

A frontend. Wire `useChat` from `ai/react` into a component pointing at `/api/chat` and you have a working chat UI. `create-next-app` output works as-is once you drop these files in.

## Multi-user buckets

The route handler reads `userId` off the request body and constructs `bucket = user-${userId}`. In a real app, resolve the user from your session cookie / auth provider server-side — **never trust a `userId` sent from the client unsigned**, because anyone can spoof it and read another user's memories.

## License

MIT. Fork it, tune it, ship it.
