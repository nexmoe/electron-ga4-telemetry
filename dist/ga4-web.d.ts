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
export interface WebParamOptions {
    /** Free-text search terms can contain sensitive information. Default false. */
    allowSearchTerms?: boolean;
}
/**
 * Sanitize GA4 Web events without dropping standard search text, transaction IDs,
 * currency values, or ecommerce items. Reject URLs, file paths and PII-like text.
 * The remaining values MUST still be business-reviewed before logging.
 */
export declare function cleanGA4WebParams(input: unknown, options?: WebParamOptions): GA4EventParams;
/** Automatic events that must remain the responsibility of Google gtag.js. */
export declare const GTAG_OWNED_EVENTS: Set<string>;
