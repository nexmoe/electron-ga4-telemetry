import type { Campaign, MetricParams, MetricValue } from './shared';
/** GA4 event names must start with a letter and use only letters, numbers and _. */
export declare const VALID_EVENT: RegExp;
export declare const SAFE_TOKEN: RegExp;
/** Drop PII-like strings, remote/local paths and unstable high-cardinality values. */
export declare function safeToken(value: unknown, maxLength?: number): string | undefined;
/** Sanitize event parameters; callers must still use approved, non-identifying vocabularies. */
export declare function cleanParams(input: unknown): MetricParams;
export declare function parseCampaign(input: string | URL | Campaign | null | undefined): Campaign | undefined;
/** A GA4 campaign configuration must be explicit and MUST NOT reuse the install campaign forever. */
export declare function toGtagCampaign(campaign: Campaign): Record<string, string>;
/** Keeps only a known section by default; nested pages need an explicit static route map. */
export declare function safeScreen(path: string): string;
export declare function routeFromLocation(location: Pick<Location, 'pathname' | 'hash'>, mode: 'history' | 'hash'): string;
export declare function isMetricValue(v: unknown): v is MetricValue;
/** ISO date in the user's local timezone; used only for one daily-active event per device. */
export declare function localDay(timestamp: number): string;
