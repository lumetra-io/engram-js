import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { makeMemoryTools } from '@/lib/tools';
import { SYSTEM_PROMPT } from '@/lib/prompt';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages, userId } = await req.json();

  // Per-user bucket. Replace with your real auth/session lookup —
  // never trust a userId sent from the client unsigned.
  const bucket = userId ? `user-${userId}` : 'default';

  const result = await streamText({
    model: openai('gpt-5'),
    system: SYSTEM_PROMPT,
    messages,
    tools: makeMemoryTools(bucket),
    maxSteps: 5,
  });

  return result.toDataStreamResponse();
}
