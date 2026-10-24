import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobsClient, LaxJobsError } from '../../src/index.js';
import { scripted, fakeSleep, SUB } from './helpers.js';

const cases: [number, string, string][] = [[400, 'bad_request', 'approach_md must be 40 to 6000 characters'], [404, 'not_found', 'job not found'], [409, 'conflict', 'the job is not taking submissions']];

for (const [status, code, msg] of cases) {
  test(`A2 a ${status} throws LaxJobsError ${code} with the registry message after a single request`, async () => {
    for (const run of [(c: ReturnType<typeof createJobsClient>) => c.getJob('x'), (c: ReturnType<typeof createJobsClient>) => c.listJobs(), (c: ReturnType<typeof createJobsClient>) => c.submit('x', SUB)]) {
      const s = scripted([{ status, body: { error: msg } }, { body: {} }]);
      const z = fakeSleep();
      const c = createJobsClient({ fetch: s.fetch, sleep: z.sleep });
      const err = await run(c).then(() => null, (e: unknown) => e);
      assert.ok(err instanceof LaxJobsError);
      assert.ok(err instanceof Error);
      assert.equal(err.status, status);
      assert.equal(err.code, code);
      assert.equal(err.message, msg);
      assert.equal(s.calls.length, 1);
      assert.equal(z.waits.length, 0);
    }
  });
}

test('A2 a non JSON error body still gives its text, and a non JSON success is invalid_response', async () => {
  let s = scripted([{ status: 404, body: 'The page could not be found' }]);
  await assert.rejects(createJobsClient({ fetch: s.fetch }).getJob('x'), { status: 404, code: 'not_found', message: 'The page could not be found' });
  s = scripted([{ status: 200, body: '<html>' }]);
  await assert.rejects(createJobsClient({ fetch: s.fetch }).getJob('x'), { code: 'invalid_response' });
});
