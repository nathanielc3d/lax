import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobsClient } from '../../src/index.js';
import { scripted, fakeSleep, JOB, SUB } from './helpers.js';

test('A4 a 5xx on a read is retried and then succeeds', async () => {
  const s = scripted([{ status: 503 }, { status: 500 }, { body: { job: JOB } }]);
  const z = fakeSleep();
  assert.deepEqual(await createJobsClient({ fetch: s.fetch, sleep: z.sleep }).getJob('job-1'), JOB);
  assert.deepEqual(z.waits, [500, 1000]);
});

test('A4 a 5xx that persists on a read throws server after the retries', async () => {
  const s = scripted([{ status: 502 }, { status: 502 }, { status: 502, body: { error: 'bad gateway' } }]);
  const z = fakeSleep();
  await assert.rejects(createJobsClient({ fetch: s.fetch, sleep: z.sleep }).listJobs(), { status: 502, code: 'server', message: 'bad gateway' });
  assert.equal(s.calls.length, 3);
});

test('A4 a network error on a read is retried, then throws network with status 0', async () => {
  const s = scripted([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]);
  const z = fakeSleep();
  await assert.rejects(createJobsClient({ fetch: s.fetch, sleep: z.sleep }).getJob('x'), { status: 0, code: 'network' });
  assert.equal(s.calls.length, 3);
  const ok = scripted([new TypeError('reset'), { body: { jobs: [JOB], count: 1 } }]);
  assert.equal((await createJobsClient({ fetch: ok.fetch, sleep: z.sleep }).listJobs()).count, 1);
});

test('A4 a timeout counts as a network error', async () => {
  const hang = (async (_u: unknown, init: RequestInit = {}) => new Promise((_ok, ko) => init.signal?.addEventListener('abort', () => ko(new Error('aborted'))))) as typeof fetch;
  const z = fakeSleep();
  await assert.rejects(createJobsClient({ fetch: hang, sleep: z.sleep, timeoutMs: 20, retries: 0 }).getJob('x'), { code: 'network', message: /timed out after 20 ms/ });
});

test('A4 submit is not retried on a 5xx or a network error', async () => {
  let s = scripted([{ status: 500, body: { error: 'boom' } }, { body: {} }]);
  const z = fakeSleep();
  await assert.rejects(createJobsClient({ fetch: s.fetch, sleep: z.sleep }).submit('j', SUB), { status: 500, code: 'server' });
  assert.equal(s.calls.length, 1);
  s = scripted([new TypeError('fetch failed'), { body: {} }]);
  await assert.rejects(createJobsClient({ fetch: s.fetch, sleep: z.sleep }).submit('j', SUB), { status: 0, code: 'network' });
  assert.equal(s.calls.length, 1);
  assert.equal(z.waits.length, 0);
});
