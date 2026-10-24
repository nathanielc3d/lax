import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobsClient } from '../../src/index.js';
import { scripted, JOB, SUB, BASE } from './helpers.js';

test('A1 listJobs sends GET /jobs with only the given parameters and returns the parsed answer', async () => {
  const s = scripted([{ body: { jobs: [JOB], count: 1 } }, { body: { jobs: [], count: 0 } }]);
  const c = createJobsClient({ fetch: s.fetch });
  assert.deepEqual(await c.listJobs({ track: 'godman-protocols', limit: 5 }), { jobs: [JOB], count: 1 });
  assert.equal(s.calls[0]!.url, `${BASE}/jobs?track=godman-protocols&limit=5`);
  assert.equal(s.calls[0]!.method, 'GET');
  await c.listJobs();
  assert.equal(s.calls[1]!.url, `${BASE}/jobs`);
});

test('A1 getJob sends GET /jobs/<id> URL encoded and returns the job out of {job}', async () => {
  const s = scripted([{ body: { job: JOB } }]);
  const c = createJobsClient({ fetch: s.fetch, baseUrl: 'https://reg.example/registry/' });
  assert.deepEqual(await c.getJob('a b/c'), JOB);
  assert.equal(s.calls[0]!.url, 'https://reg.example/registry/jobs/a%20b%2Fc');
});

test('A1 submit POSTs JSON without the job id and returns the submission out of {submission}', async () => {
  const answer = { id: 'sub-1', job_id: 'job-1', status: 'received', created_at: '2026-10-24T13:00:00Z' };
  const s = scripted([{ status: 201, body: { submission: answer } }]);
  const c = createJobsClient({ fetch: s.fetch });
  assert.deepEqual(await c.submit('job-1', { ...SUB, notes: 'n' }), answer);
  const call = s.calls[0]!;
  assert.equal(call.url, `${BASE}/jobs/job-1/submissions`);
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(call.body!), { ...SUB, notes: 'n' });
});

test('A1 listJobs refuses a limit outside 1 to 100 before any request', async () => {
  const s = scripted([]);
  const c = createJobsClient({ fetch: s.fetch });
  for (const limit of [0, 101, 2.5]) await assert.rejects(c.listJobs({ limit }), { code: 'invalid_input' });
  assert.equal(s.calls.length, 0);
});
