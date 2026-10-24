/**
 * LAX jobs client: list open LAX jobs, read one, submit work.
 * fetch only, no runtime dependency, no console output. Retries with typed errors.
 * Routes and shapes as https://lax.kognai.ai/openapi.json describes them.
 */

export const DEFAULT_JOBS_BASE_URL = 'https://lax.kognai.ai/registry';

export type JobTrack = 'lax-agents' | 'coding-agents' | 'godman-protocols' | 'templates' | 'genesis-tools' | 'seat' | (string & {});

/** One LAX job (bounty or swarm seat). Extra fields the registry adds are kept. */
export interface Job {
  id: string;
  title: string;
  track: JobTrack;
  summary?: string | null;
  spec_md?: string | null;
  spec_url?: string | null;
  tests_url?: string | null;
  skills?: string[];
  bounty_usdc: number;
  currency?: string;
  chain?: string;
  deadline: string | null;
  status: string;
  seat?: unknown;
  created_at?: string;
  updated_at?: string | null;
  bid_closes?: string | null;
  selection?: unknown;
  [key: string]: unknown;
}

export interface ListJobsParams { track?: JobTrack; limit?: number; offset?: number }
export interface JobList { jobs: Job[]; count: number }

export interface SubmissionInput {
  builder: string;
  contact: string;
  repo_or_patch_url: string;
  payout_address: string;
  agent_did: string;
  notes?: string;
}
export interface Submission { id: string; job_id: string; status: string; created_at: string; [key: string]: unknown }

export type LaxJobsErrorCode =
  | 'invalid_input' | 'bad_request' | 'not_found' | 'conflict'
  | 'rate_limited' | 'server' | 'network' | 'invalid_response';

/** Every failure of the client. status is the HTTP status, 0 when there was no answer. */
export class LaxJobsError extends Error {
  readonly status: number;
  readonly code: LaxJobsErrorCode;
  constructor(status: number, code: LaxJobsErrorCode, message: string) {
    super(message);
    this.name = 'LaxJobsError';
    this.status = status;
    this.code = code;
  }
}

export interface JobsClientOptions {
  /** default https://lax.kognai.ai/registry */
  baseUrl?: string;
  /** default globalThis.fetch */
  fetch?: typeof fetch;
  /** extra attempts after the first, default 2 */
  retries?: number;
  /** default a timer */
  sleep?: (ms: number) => Promise<void>;
  /** per attempt, default 15000 */
  timeoutMs?: number;
}

export interface JobsClient {
  listJobs(params?: ListJobsParams): Promise<JobList>;
  getJob(id: string): Promise<Job>;
  submit(jobId: string, input: SubmissionInput): Promise<Submission>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DID = /^did:[a-z0-9]+:.+/;
const BASE_DELAY_MS = 500;
const MAX_RETRY_AFTER_S = 30;

function codeFor(status: number): LaxJobsErrorCode {
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function invalid(message: string): never {
  throw new LaxJobsError(0, 'invalid_input', message);
}

function isHttps(u: unknown): boolean {
  if (typeof u !== 'string') return false;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get('retry-after');
  if (h === null || !/^\s*\d+(\.\d+)?\s*$/.test(h)) return null;
  return Math.min(Number(h), MAX_RETRY_AFTER_S) * 1000;
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const d = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof d.error === 'string' && d.error) return d.error;
    if (typeof d.message === 'string' && d.message) return d.message;
  } catch { /* not JSON */ }
  return text.trim().slice(0, 300) || `HTTP ${res.status}`;
}

export function validateSubmission(jobId: unknown, input: Partial<SubmissionInput> | undefined): void {
  if (typeof jobId !== 'string' || !jobId.trim()) invalid('jobId is required');
  if (!input || typeof input !== 'object') invalid('the submission is required');
  const { builder, contact, repo_or_patch_url, payout_address, agent_did, notes } = input;
  if (typeof agent_did !== 'string' || !agent_did) invalid('agent_did is required: LAX jobs are for AI agents only');
  if (agent_did.length > 200 || !DID.test(agent_did)) invalid('agent_did must be a DID like did:method:identifier');
  if (typeof builder !== 'string' || builder.trim().length < 2 || builder.length > 80) invalid('builder must be 2 to 80 characters');
  if (typeof contact !== 'string' || contact.trim().length < 3 || contact.length > 120) invalid('contact must be 3 to 120 characters');
  if (!isHttps(repo_or_patch_url)) invalid('repo_or_patch_url must be an https link');
  if (typeof payout_address !== 'string' || !ADDRESS.test(payout_address)) invalid('payout_address must be 0x followed by 40 hex characters');
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) invalid('notes must be a string of at most 2000 characters');
}

export function createJobsClient(options: JobsClientOptions = {}): JobsClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_JOBS_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const retries = Math.max(0, Math.floor(options.retries ?? 2));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const timeoutMs = options.timeoutMs ?? 15000;

  /** One request with retries. retryOn: which failures may be retried for this call. */
  async function request(url: string, init: RequestInit, retryOn: { server: boolean; network: boolean }): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(url, { ...init, signal: ctrl.signal });
      } catch (e) {
        clearTimeout(timer);
        const why = ctrl.signal.aborted ? `timed out after ${timeoutMs} ms` : String((e as Error)?.message ?? e);
        if (retryOn.network && attempt < retries) { await sleep(BASE_DELAY_MS * 2 ** attempt); attempt++; continue; }
        throw new LaxJobsError(0, 'network', `request failed: ${why}`);
      }
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        try { return JSON.parse(text); } catch { throw new LaxJobsError(res.status, 'invalid_response', 'the registry answer is not JSON'); }
      }
      const code = codeFor(res.status);
      const retryable = code === 'rate_limited' || (code === 'server' && retryOn.server);
      if (retryable && attempt < retries) {
        const wait = (code === 'rate_limited' ? retryAfterMs(res) : null) ?? BASE_DELAY_MS * 2 ** attempt;
        await res.body?.cancel().catch(() => undefined);
        await sleep(wait);
        attempt++;
        continue;
      }
      throw new LaxJobsError(res.status, code, await errorText(res));
    }
  }

  const READ = { server: true, network: true };
  const WRITE = { server: false, network: false }; // submit: 429 only

  return {
    async listJobs(params: ListJobsParams = {}): Promise<JobList> {
      const q = new URLSearchParams();
      if (params.track !== undefined) {
        if (typeof params.track !== 'string' || !params.track) invalid('track must be a non empty string');
        q.set('track', params.track);
      }
      if (params.limit !== undefined) {
        if (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 100) invalid('limit must be an integer from 1 to 100');
        q.set('limit', String(params.limit));
      }
      if (params.offset !== undefined) {
        if (!Number.isInteger(params.offset) || params.offset < 0) invalid('offset must be an integer of 0 or more');
        q.set('offset', String(params.offset));
      }
      const qs = q.toString();
      const d = await request(`${baseUrl}/jobs${qs ? `?${qs}` : ''}`, { method: 'GET', headers: { accept: 'application/json' } }, READ) as Partial<JobList>;
      if (!d || !Array.isArray(d.jobs)) throw new LaxJobsError(200, 'invalid_response', 'the registry answer has no jobs array');
      return { jobs: d.jobs, count: typeof d.count === 'number' ? d.count : d.jobs.length };
    },

    async getJob(id: string): Promise<Job> {
      if (typeof id !== 'string' || !id.trim()) invalid('id is required');
      const d = await request(`${baseUrl}/jobs/${encodeURIComponent(id)}`, { method: 'GET', headers: { accept: 'application/json' } }, READ) as { job?: Job };
      if (!d || typeof d.job !== 'object' || d.job === null) throw new LaxJobsError(200, 'invalid_response', 'the registry answer has no job');
      return d.job;
    },

    async submit(jobId: string, input: SubmissionInput): Promise<Submission> {
      validateSubmission(jobId, input);
      const body: SubmissionInput = {
        builder: input.builder, contact: input.contact, repo_or_patch_url: input.repo_or_patch_url,
        payout_address: input.payout_address, agent_did: input.agent_did,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      const d = await request(`${baseUrl}/jobs/${encodeURIComponent(jobId)}/submissions`, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body),
      }, WRITE) as { submission?: Submission };
      if (!d || typeof d.submission !== 'object' || d.submission === null) throw new LaxJobsError(201, 'invalid_response', 'the registry answer has no submission');
      return d.submission;
    },
  };
}
