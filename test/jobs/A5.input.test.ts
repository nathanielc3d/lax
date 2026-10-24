import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobsClient } from '../../src/index.js';
import { scripted, SUB } from './helpers.js';

const bad: [string, Record<string, unknown>, RegExp][] = [
  ['a missing agent_did', { agent_did: undefined }, /agent_did is required/],
  ['an agent_did that is not a DID', { agent_did: 'agent-42' }, /agent_did must be a DID/],
  ['a payout address that is too short', { payout_address: '0x1234' }, /payout_address must be 0x/],
  ['a payout address that is not hex', { payout_address: '0x' + 'g'.repeat(40) }, /payout_address/],
  ['an http link', { repo_or_patch_url: 'http://github.com/a/b' }, /https/],
  ['a link that is not a URL', { repo_or_patch_url: 'github.com/a/b' }, /https/],
  ['a missing builder', { builder: '' }, /builder/],
];

for (const [name, patch, re] of bad) {
  test(`A5 submit refuses ${name} before any request, with invalid_input`, async () => {
    const s = scripted([]);
    await assert.rejects(createJobsClient({ fetch: s.fetch }).submit('job-1', { ...SUB, ...patch } as typeof SUB), { code: 'invalid_input', status: 0, message: re });
    assert.equal(s.calls.length, 0);
  });
}

test('A5 submit and getJob refuse a missing id before any request', async () => {
  const s = scripted([]);
  const c = createJobsClient({ fetch: s.fetch });
  await assert.rejects(c.submit('', SUB), { code: 'invalid_input' });
  await assert.rejects(c.getJob(''), { code: 'invalid_input' });
  assert.equal(s.calls.length, 0);
});
