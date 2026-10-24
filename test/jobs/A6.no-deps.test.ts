import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJobsClient } from '../../src/index.js';
import { scripted, fakeSleep, SUB } from './helpers.js';

test('A6 no runtime dependency in the package and none imported by src/jobs.ts', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  const src = readFileSync(new URL('../../src/jobs.ts', import.meta.url), 'utf8');
  assert.deepEqual(src.match(/^\s*import\s.+from\s+['"][^'"]+['"]/gm) ?? [], []);
  assert.doesNotMatch(src, /\bconsole\./);
});

test('A6 the client writes nothing to the console, on success or failure', async () => {
  const seen: string[] = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(saved) as (keyof typeof saved)[]) console[k] = (...a: unknown[]) => { seen.push(a.join(' ')); };
  try {
    const s = scripted([{ status: 500 }, new TypeError('x'), { body: { jobs: [], count: 0 } }, { status: 404, body: { error: 'nope' } }, { status: 429 }]);
    const z = fakeSleep();
    const c = createJobsClient({ fetch: s.fetch, sleep: z.sleep });
    await c.listJobs();
    await c.getJob('x').catch(() => undefined);
    await c.submit('j', SUB).catch(() => undefined);
    await c.submit('j', { ...SUB, payout_address: 'bad' }).catch(() => undefined);
  } finally { Object.assign(console, saved); }
  assert.deepEqual(seen, []);
});
