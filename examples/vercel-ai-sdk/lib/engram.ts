import { EngramClient } from '@lumetra/engram';

export const engram = new EngramClient({
  apiKey: process.env.ENGRAM_API_KEY!,
  baseUrl: process.env.ENGRAM_BASE_URL,
});
