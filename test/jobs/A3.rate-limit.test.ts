import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobsClient } from '../../src/index.js';
import { scripted, fakeSleep, JOB, SUB } from './helpers.js';

test('A3 a 429 is retried after its Retry-After and then succeeds', async () => {
  const s = scripted([{ status: 429, body: { error: 'slow down' }, headers: { 'retry-after': '3' } }, { body: { job: JOB } }]);
  const z = fakeSleep();
  assert.deepEqual(await createJobsClient({ fetch: s.fetch, sleep: z.sleep }).getJob('job-1'), JOB);
  assert.deepEqual(z.waits, [3000]);
  assert.equal(s.calls.length, 2);
});

test('A3 Retry-After is capped at 30 seconds; without it the wait is 500 ms doubled', async () => {
  const s = scripted([{ status: 429, headers: { 'retry-after': '120' } }, { status: 429 }, { body: { jobs: [], count: 0 } }]);
  const z = fakeSleep();
  await createJobsClient({ fetch: s.fetch, sleep: z.sleep }).listJobs();
  assert.deepEqual(z.waits, [30000, 1000]);
});

test('A3 submit is retried on 429', async () => {
  const sub = { id: 's', job_id: 'j', status: 'received', created_at: 'now' };
  const s = scripted([{ status: 429, headers: { 'retry-after': '1' } }, { status: 201, body: { submission: sub } }]);
  const z = fakeSleep();
  assert.deepEqual(await createJobsClient({ fetch: s.fetch, sleep: z.sleep }).submit('j', SUB), sub);
  assert.equal(s.calls.length, 2);
});

test('A3 when 429 never ends the last retry throws rate_limited', async () => {
  const s = scripted([{ status: 429, body: { error: 'too many submissions' } }, { status: 429 }, { status: 429, body: { error: 'too many submissions' } }, { body: {} }]);
  const z = fakeSleep();
  await assert.rejects(createJobsClient({ fetch: s.fetch, sleep: z.sleep, retries: 2 }).submit('j', SUB), { status: 429, code: 'rate_limited', message: 'too many submissions' });
  assert.equal(s.calls.length, 3);
  assert.deepEqual(z.waits, [500, 1000]);
});
