import type { Campaign, CampaignField, MetricParams, MetricValue } from './shared';

/** GA4 event names must start with a letter and use only letters, numbers and _. */
export const VALID_EVENT = /^[a-z][a-z0-9_]{0,39}$/;
export const SAFE_TOKEN = /^[a-z0-9][a-z0-9_.-]{0,79}$/i;
const CAMPAIGN_KEYS: readonly CampaignField[] = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content', 'utm_term',
];

/** Drop PII-like strings, remote/local paths and unstable high-cardinality values. */
export function safeToken(value: unknown, maxLength = 80): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (!v || v.length > maxLength || !SAFE_TOKEN.test(v)) return undefined;
  return v;
}

/** Sanitize event parameters; callers must still use approved, non-identifying vocabularies. */
export function cleanParams(input: unknown): MetricParams {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: MetricParams = {};
  for (const [key, value] of Object.entries(input)) {
    if (!VALID_EVENT.test(key) || Object.keys(out).length >= 22) continue;
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string') {
      const s = safeToken(value);
      if (s !== undefined) out[key] = s;
    }
  }
  return out;
}

export function parseCampaign(input: string | URL | Campaign | null | undefined): Campaign | undefined {
  if (!input) return undefined;
  let data: Record<string, unknown> = {};
  if (typeof input === 'string' || input instanceof URL) {
    try {
      const url = input instanceof URL ? input : new URL(input);
      for (const k of CAMPAIGN_KEYS) data[k] = url.searchParams.get(k);
    } catch { return undefined; }
  } else if (typeof input === 'object' && !Array.isArray(input)) {
    data = input;
  }
  const campaign: Campaign = {};
  for (const key of CAMPAIGN_KEYS) {
    const value = safeToken(data[key], 60);
    if (value) campaign[key] = value;
  }
  return Object.keys(campaign).length ? campaign : undefined;
}

/** A GA4 campaign configuration must be explicit and MUST NOT reuse the install campaign forever. */
export function toGtagCampaign(campaign: Campaign): Record<string, string> {
  const mapped: Record<string, string> = {};
  const keys = {
    utm_source: 'campaign_source', utm_medium: 'campaign_medium',
    utm_campaign: 'campaign_name', utm_id: 'campaign_id',
    utm_content: 'campaign_content', utm_term: 'campaign_term',
  } as const;
  for (const [source, target] of Object.entries(keys)) {
    const value = campaign[source as CampaignField];
    if (value) mapped[target] = value;
  }
  return mapped;
}

const SENSITIVE_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{20,}|[0-9a-f]{16,}|[a-z0-9_-]{18,})$/i;

/** Keeps only a known section by default; nested pages need an explicit static route map. */
export function safeScreen(path: string): string {
  const raw = path.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, '');
  if (!raw || raw === 'index.html') return 'home';
  const segments = raw.split('/');
  // Never expose local filesystem paths or full arbitrary router paths to GA4.
  const first = segments[0].toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,24}$/.test(first) || SENSITIVE_SEGMENT.test(first)) return 'other';
  return segments.length === 1 ? first : `${first}/detail`;
}

export function routeFromLocation(location: Pick<Location, 'pathname' | 'hash'>, mode: 'history' | 'hash'): string {
  if (mode === 'hash') {
    const hash = location.hash.replace(/^#/, '');
    return hash.startsWith('/') ? hash : '/';
  }
  if (location.pathname.endsWith('/index.html') || location.pathname === '/index.html') return '/';
  return location.pathname;
}

export function isMetricValue(v: unknown): v is MetricValue {
  return typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
}

/** ISO date in the user's local timezone; used only for one daily-active event per device. */
export function localDay(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
