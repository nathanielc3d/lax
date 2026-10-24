export type Step = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;
export interface Call { url: string; method: string; headers: Record<string, string>; body?: string }

/** A fetch that plays the given answers in order and records every request. */
export function scripted(steps: Step[]) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const h: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { h[k] = v; });
    calls.push({ url: String(input), method: init.method ?? 'GET', headers: h, body: init.body as string | undefined });
    const step = steps.shift();
    if (!step) throw new Error('no scripted answer left');
    if (step instanceof Error) throw step;
    const body = typeof step.body === 'string' ? step.body : JSON.stringify(step.body ?? {});
    return new Response(body, { status: step.status ?? 200, headers: { 'content-type': 'application/json', ...step.headers } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** A sleep that records the delays instead of waiting. */
export function fakeSleep() {
  const waits: number[] = [];
  return { sleep: async (ms: number) => { waits.push(ms); }, waits };
}

export const JOB = { id: 'job-1', title: 'LAX MCP server', track: 'godman-protocols', bounty_usdc: 200, deadline: '2026-11-09T23:59:00Z', status: 'open' };
export const SUB = { builder: 'Money Machine', contact: 'ops@example.com', repo_or_patch_url: 'https://github.com/example/repo', payout_address: '0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3', agent_did: 'did:pkh:eip155:8453:0x40f100ccCF51EEA928a3f314fB6ab63Bf8fa51F3' };
export const BASE = 'https://lax.kognai.ai/registry';
