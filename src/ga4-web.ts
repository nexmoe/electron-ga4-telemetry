/** GA4 Web event payload compatibility. No API secret and no Measurement Protocol dependency. */

/** Standard GA4 ecommerce item fields. Only allowlisted item fields are forwarded. */
export interface GA4Item {
  item_id?: string;
  item_name?: string;
  affiliation?: string;
  coupon?: string;
  discount?: number;
  index?: number;
  item_brand?: string;
  item_category?: string;
  item_category2?: string;
  item_category3?: string;
  item_category4?: string;
  item_category5?: string;
  item_list_id?: string;
  item_list_name?: string;
  item_variant?: string;
  location_id?: string;
  price?: number;
  quantity?: number;
  promotion_id?: string;
  promotion_name?: string;
  creative_name?: string;
  creative_slot?: string;
}

/** GA4 event parameter values supported by this privacy-preserving wrapper. */
export type GA4Value = string | number | boolean | GA4Item[];
export type GA4EventParams = Record<string, GA4Value | undefined>;

const EVENT_PARAM_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const ITEM_STRING_KEYS = new Set([
  'item_id', 'item_name', 'affiliation', 'coupon', 'item_brand', 'item_category',
  'item_category2', 'item_category3', 'item_category4', 'item_category5',
  'item_list_id', 'item_list_name', 'item_variant', 'location_id',
  'promotion_id', 'promotion_name', 'creative_name', 'creative_slot',
]);
const ITEM_NUMBER_KEYS = new Set(['discount', 'index', 'price', 'quantity']);
const RESERVED_KEYS = new Set([
  'send_to', 'page_location', 'page_title', 'page_referrer', 'client_id',
  'user_id', 'session_id', 'engagement_time_msec',
]);
const PRIVATE_PARAM_NAMES = new Set([
  'email', 'phone', 'password', 'token', 'authorization', 'api_key', 'ip',
  'full_name', 'address', 'file_name', 'file_path', 'video_url',
]);
// Caller is still responsible for ensuring that public labels/IDs do not encode personal data.
const SUSPECT_TEXT = /[\r\n\0]|(?:https?:\/\/|file:\/\/|[a-z]:\\|\/users\/|\/home\/)|(?:\b[^\s@]+@[^\s@]+\.[^\s@]+\b)|(?:bearer\s+\S+)|(?:\b(?:api[_ -]?key|password|secret|token)\s*[:=])/i;

function cleanText(value: unknown, limit = 100): string | undefined {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (!text || text.length > limit || text.startsWith('/') || text.startsWith('\\') || SUSPECT_TEXT.test(text)) return;
  return text;
}

function cleanItem(value: unknown): GA4Item | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const out: Record<string, string | number> = {};
  for (const [key, v] of Object.entries(value)) {
    if (ITEM_NUMBER_KEYS.has(key) && typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    if (ITEM_STRING_KEYS.has(key)) {
      const label = cleanText(v);
      if (label !== undefined) out[key] = label;
    }
  }
  // GA4 recommended ecommerce items require item_id or item_name.
  return (out.item_id || out.item_name) ? out as GA4Item : undefined;
}

export interface WebParamOptions {
  /** Free-text search terms can contain sensitive information. Default false. */
  allowSearchTerms?: boolean;
}

/**
 * Sanitize GA4 Web events without dropping standard search text, transaction IDs,
 * currency values, or ecommerce items. Reject URLs, file paths and PII-like text.
 * The remaining values MUST still be business-reviewed before logging.
 */
export function cleanGA4WebParams(input: unknown, options: WebParamOptions = {}): GA4EventParams {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: GA4EventParams = {};
  // Keep spare GA4 parameter slots for page_location, page_title and send_to.
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(out).length >= 20) break;
    if (!EVENT_PARAM_NAME.test(key) || RESERVED_KEYS.has(key) || PRIVATE_PARAM_NAMES.has(key)) continue;
    if (key === 'search_term' && !options.allowSearchTerms) continue;
    if (key === 'link_url') {
      // Only a redacted HTTPS origin, never a path, query string or fragment.
      if (typeof value === 'string') {
        try {
          const u = new URL(value);
          if (u.protocol === 'https:' && !u.username && !u.password &&
              u.pathname === '/' && !u.search && !u.hash) out.link_url = u.origin;
        } catch { /* Ignore malformed and non-URL values. */ }
      }
      continue;
    }
    if (key === 'items') {
      if (!Array.isArray(value)) continue;
      const items = value.slice(0, 200).flatMap((entry): GA4Item[] => {
        const clean = cleanItem(entry);
        return clean ? [clean] : [];
      });
      if (items.length) out.items = items;
      continue;
    }
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else {
      const result = cleanText(value);
      if (result !== undefined) out[key] = result;
    }
  }
  return out;
}

/** Automatic events that must remain the responsibility of Google gtag.js. */
export const GTAG_OWNED_EVENTS = new Set([
  'first_visit', 'session_start', 'user_engagement', 'page_view',
]);
