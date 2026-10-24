import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobsClient } from '../../src/index.js';

const live = process.env.LAX_LIVE === '1';
test('A7 live: GET /jobs on lax.kognai.ai (only with LAX_LIVE=1)', { skip: live ? false : 'set LAX_LIVE=1 to read the live registry' }, async () => {
  const c = createJobsClient();
  const { jobs, count } = await c.listJobs({ limit: 5 });
  assert.ok(Array.isArray(jobs) && jobs.length > 0 && jobs.length <= 5);
  assert.equal(typeof count, 'number');
  const one = await c.getJob(jobs[0]!.id);
  assert.equal(one.id, jobs[0]!.id);
  assert.equal(typeof one.title, 'string');
  assert.equal(typeof one.bounty_usdc, 'number');
});
