import { tool } from 'ai';
import { z } from 'zod';
import { EngramError } from '@lumetra/engram';
import { engram } from './engram';

export function makeMemoryTools(bucket: string) {
  return {
    store_memory: tool({
      description:
        'Save a stable fact about the user, their preferences, or the project. ' +
        'Use this after the user shares something durable that will matter in a future conversation. ' +
        'Keep each stored fact short and atomic (one concept per call).',
      parameters: z.object({
        content: z.string().describe('A short, declarative fact. One sentence is ideal.'),
      }),
      execute: async ({ content }) => {
        try {
          const result = await engram.storeMemory(content, bucket);
          return { stored: true, id: result.id };
        } catch (err) {
          if (err instanceof EngramError && err.status === 412) {
            return {
              stored: false,
              error: 'Memory provider is not configured. Visit Engram settings to add an LLM key.',
            };
          }
          return { stored: false, error: 'Could not reach memory service.' };
        }
      },
    }),

    query_memory: tool({
      description:
        "Search the user's memory for relevant facts before answering. " +
        'Call this whenever the answer might depend on prior context, preferences, ' +
        'or anything the user told you in a previous session.',
      parameters: z.object({
        question: z.string().describe('A natural-language query. Phrase it as a question.'),
      }),
      execute: async ({ question }) => {
        try {
          const result = await engram.query(question, {
            buckets: [bucket],
            topK: 8,
            returnExplanation: true,
          });
          const retrieved = result.explanation?.retrieved_memories ?? [];
          return {
            answer: result.answer,
            memories: retrieved.map((m) => m.content),
          };
        } catch (err) {
          if (err instanceof EngramError && err.status === 412) {
            return {
              answer: null,
              memories: [],
              error: 'Memory provider is not configured. Visit Engram settings to add an LLM key.',
            };
          }
          return { answer: null, memories: [], error: 'Could not reach memory service.' };
        }
      },
    }),

    list_memories: tool({
      description:
        'List recently stored memories. Use this rarely, only when the user explicitly asks ' +
        'to see or audit what you have remembered about them.',
      parameters: z.object({
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ limit }) => {
        const result = await engram.listMemories(bucket, { limit });
        return { memories: result.memories.map((m) => ({ id: m.id, content: m.content })) };
      },
    }),
  };
}
