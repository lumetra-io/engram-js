// Tests for @lumetra/engram. Uses Node's built-in test runner — zero new
// devDeps. Mocks fetch via the Client's `fetch` option so no network is
// touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngramClient, EngramError } from '../dist/index.js';

const KEY = 'eng_live_test_key';
const BASE = 'https://api.lumetra.io';

function mockFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    const call = { url: url.toString(), init };
    calls.push(call);
    const { status, body, contentType } = responder(call) ?? { status: 200, body: {} };
    return new Response(body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : '', {
      status,
      headers: { 'Content-Type': contentType ?? 'application/json' },
    });
  };
  return { fn, calls };
}

test('constructor: requires an api key', () => {
  delete process.env.ENGRAM_API_KEY;
  assert.throws(() => new EngramClient(), /apiKey is required/);
});

test('constructor: reads ENGRAM_API_KEY from env', () => {
  process.env.ENGRAM_API_KEY = KEY;
  const c = new EngramClient();
  assert.equal(typeof c.storeMemory, 'function');
  delete process.env.ENGRAM_API_KEY;
});

test('constructor: trailing slash in baseUrl is stripped', async () => {
  const m = mockFetch(() => ({ status: 200, body: { id: 'x', bucket_name: 'b', token_count: 1 } }));
  const c = new EngramClient({ apiKey: KEY, baseUrl: 'https://staging.lumetra.io///', fetch: m.fn });
  await c.storeMemory('hi', 'b');
  assert.ok(m.calls[0].url.startsWith('https://staging.lumetra.io/v1/'), `unexpected ${m.calls[0].url}`);
});

test('storeMemory: POSTs to /v1/buckets/{b}/memories with content body and auth header', async () => {
  const m = mockFetch(() => ({ status: 200, body: { id: 'mem_1', bucket_name: 'work', token_count: 7 } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  const r = await c.storeMemory('User prefers tabs.', 'work');
  assert.equal(m.calls[0].url, `${BASE}/v1/buckets/work/memories`);
  assert.equal(m.calls[0].init.method, 'POST');
  assert.equal(m.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(m.calls[0].init.body), { content: 'User prefers tabs.' });
  assert.equal(r.id, 'mem_1');
});

test('storeMemories: batch body shape', async () => {
  const m = mockFetch(() => ({ status: 200, body: { memories: [{ id: 'a', bucket_name: 'work', token_count: 1 }] } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await c.storeMemories(['one', 'two'], 'work');
  assert.deepEqual(JSON.parse(m.calls[0].init.body), {
    memories: [{ content: 'one' }, { content: 'two' }],
  });
});

test('storeMemories: defensively unwraps a bare-array response', async () => {
  const m = mockFetch(() => ({ status: 200, body: [{ id: 'a', bucket_name: 'work', token_count: 1 }] }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  const r = await c.storeMemories(['one'], 'work');
  assert.ok(Array.isArray(r.memories) && r.memories[0].id === 'a');
});

test('query: maps top_k / skip_synthesis / return_explanation correctly', async () => {
  const m = mockFetch(() => ({ status: 200, body: { answer: 'ok' } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await c.query('q?', { buckets: ['a', 'b'], topK: 12, skipSynthesis: false, returnExplanation: true });
  const body = JSON.parse(m.calls[0].init.body);
  assert.deepEqual(body, {
    query: 'q?',
    buckets: ['a', 'b'],
    options: { top_k: 12, return_explanation: true, skip_synthesis: false },
  });
});

test('query: defaults — buckets=["default"], top_k=8, return_explanation=true, skip_synthesis=false', async () => {
  const m = mockFetch(() => ({ status: 200, body: { answer: '' } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await c.query('plain');
  const body = JSON.parse(m.calls[0].init.body);
  assert.deepEqual(body.buckets, ['default']);
  assert.equal(body.options.top_k, 8);
  assert.equal(body.options.return_explanation, true);
  assert.equal(body.options.skip_synthesis, false);
});

test('listMemories: limit + offset query params', async () => {
  const m = mockFetch(() => ({ status: 200, body: { memories: [], total: 0, limit: 50, offset: 10 } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await c.listMemories('work', { limit: 50, offset: 10 });
  assert.equal(m.calls[0].url, `${BASE}/v1/buckets/work/memories?limit=50&offset=10`);
  assert.equal(m.calls[0].init.method, 'GET');
});

test('deleteMemory: DELETE /v1/buckets/{b}/memories/{id}', async () => {
  const m = mockFetch(() => ({ status: 200, body: { ok: true } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await c.deleteMemory('mem_abc', 'work');
  assert.equal(m.calls[0].url, `${BASE}/v1/buckets/work/memories/mem_abc`);
  assert.equal(m.calls[0].init.method, 'DELETE');
});

test('clearMemories: DELETE /v1/buckets/{b}/memories (collection)', async () => {
  const m = mockFetch(() => ({ status: 200, body: { ok: true } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await c.clearMemories('work');
  assert.equal(m.calls[0].url, `${BASE}/v1/buckets/work/memories`);
  assert.equal(m.calls[0].init.method, 'DELETE');
});

test('listBuckets: accepts wrapped { buckets: [...] }', async () => {
  const m = mockFetch(() => ({ status: 200, body: { buckets: [{ id: 'b1', name: 'work', created_at: 't' }] } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  const r = await c.listBuckets();
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'work');
});

test('listBuckets: accepts bare-array response', async () => {
  const m = mockFetch(() => ({ status: 200, body: [{ id: 'b1', name: 'work', created_at: 't' }] }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  const r = await c.listBuckets();
  assert.equal(r.length, 1);
});

test('createBucket: POST /v1/buckets with name + description', async () => {
  const m = mockFetch(() => ({ status: 200, body: { id: 'b2', name: 'new', created_at: 't' } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await c.createBucket('new', 'a test bucket');
  assert.equal(m.calls[0].url, `${BASE}/v1/buckets`);
  assert.equal(m.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(m.calls[0].init.body), { name: 'new', description: 'a test bucket' });
});

test('bucket names get URL-encoded', async () => {
  const m = mockFetch(() => ({ status: 200, body: { id: 'x', bucket_name: 'user 123', token_count: 1 } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await c.storeMemory('test', 'user 123/spaces');
  assert.equal(m.calls[0].url, `${BASE}/v1/buckets/user%20123%2Fspaces/memories`);
});

test('412 → EngramError with status + body', async () => {
  const m = mockFetch(() => ({ status: 412, body: { error: 'No model provider key configured' } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await assert.rejects(
    () => c.storeMemory('x', 'b'),
    (err) => {
      assert.ok(err instanceof EngramError);
      assert.equal(err.status, 412);
      assert.deepEqual(err.body, { error: 'No model provider key configured' });
      return true;
    },
  );
});

test('401 → EngramError', async () => {
  const m = mockFetch(() => ({ status: 401, body: { error: 'Invalid API key' } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await assert.rejects(() => c.query('x'), (err) => err instanceof EngramError && err.status === 401);
});

test('non-JSON 500 keeps body as raw string', async () => {
  const m = mockFetch(() => ({ status: 500, body: '<html>500</html>', contentType: 'text/html' }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await assert.rejects(
    () => c.query('x'),
    (err) => err instanceof EngramError && err.status === 500 && /<html>/.test(String(err.body)),
  );
});

test('deleteBucket: DELETEs /v1/buckets/{b}', async () => {
  const m = mockFetch(() => ({ status: 200, body: {} }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await c.deleteBucket('scratch');
  assert.equal(m.calls[0].url, `${BASE}/v1/buckets/scratch`);
  assert.equal(m.calls[0].init.method, 'DELETE');
  assert.equal(m.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
});

test('getProfile: GETs /v1/buckets/{b}/profile and returns body', async () => {
  const m = mockFetch(() => ({ status: 200, body: { profile: 'User likes tea.' } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  const r = await c.getProfile('work');
  assert.equal(m.calls[0].url, `${BASE}/v1/buckets/work/profile`);
  assert.equal(m.calls[0].init.method, 'GET');
  assert.equal(r.profile, 'User likes tea.');
});

test('getProfile: defaults bucket to "default"', async () => {
  const m = mockFetch(() => ({ status: 200, body: { profile: null } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  await c.getProfile();
  assert.equal(m.calls[0].url, `${BASE}/v1/buckets/default/profile`);
});

test('regenerateProfile: POSTs /v1/buckets/{b}/profile/regenerate', async () => {
  const m = mockFetch(() => ({ status: 200, body: { profile: 'New profile.' } }));
  const c = new EngramClient({ apiKey: KEY, fetch: m.fn });
  const r = await c.regenerateProfile('work');
  assert.equal(m.calls[0].url, `${BASE}/v1/buckets/work/profile/regenerate`);
  assert.equal(m.calls[0].init.method, 'POST');
  assert.equal(r.profile, 'New profile.');
});

test('timeoutMs: aborts a slow request', async () => {
  // Custom fetch never resolves until aborted; client should reject via AbortSignal.
  const fn = (url, init) =>
    new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  const c = new EngramClient({ apiKey: KEY, fetch: fn, timeoutMs: 25 });
  await assert.rejects(() => c.storeMemory('x', 'b'), (err) => err && err.name === 'AbortError');
});

test('uses globalThis.fetch when no custom fetch is provided', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (url, init) => {
    called = true;
    return new Response(JSON.stringify({ id: 'g', bucket_name: 'b', token_count: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const c = new EngramClient({ apiKey: KEY });
    await c.storeMemory('hi', 'b');
    assert.equal(called, true);
  } finally {
    globalThis.fetch = original;
  }
});
