const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanGA4WebParams, GTAG_OWNED_EVENTS } = require('../dist/ga4-web.js');

test('preserves official ecommerce items, revenue fields, spaces, and transaction IDs', () => {
  const result = cleanGA4WebParams({
    transaction_id: 'order_123', currency: 'USD', value: 19.99,
    items: [{item_id: 'pro_monthly', item_name: 'Pro Plan', price: 19.99,
      quantity: 1, item_category: 'Subscriptions', unknownSecret: 'not sent'}],
    my_nasty: 'user@example.com',
    local_path: '/Users/Alice/private.pdf',
    page_location: 'https://steal.example/?token=secret',
    weird_array: [{ anything: true }],
  });
  assert.deepEqual(result, {
    transaction_id: 'order_123', currency: 'USD', value: 19.99,
    items: [{item_id: 'pro_monthly', item_name: 'Pro Plan', price: 19.99,
      quantity: 1, item_category: 'Subscriptions'}],
  });
});

test('search terms require explicit privacy decision; no email/url leakage', () => {
  assert.deepEqual(cleanGA4WebParams({search_term: 'pink socks'}), {});
  assert.deepEqual(cleanGA4WebParams({search_term: 'pink socks'}, {allowSearchTerms:true}), {search_term:'pink socks'});
  assert.deepEqual(cleanGA4WebParams({search_term: 'hello@example.com'}, {allowSearchTerms:true}), {});
});

test('only a public HTTPS origin can be reported as outbound link_url', () => {
  const result = cleanGA4WebParams({
    link_url: 'https://example.org', link_domain: 'example.org', outbound: true,
  });
  assert.deepEqual(result, {link_url:'https://example.org', link_domain:'example.org',outbound:true});
  assert.deepEqual(cleanGA4WebParams({link_url:'https://example.org/private?id=2'}), {});
});

test('does not allow faking automatic gtag events', () => {
  for (const ev of ['first_visit','session_start','page_view','user_engagement']) {
    assert.equal(GTAG_OWNED_EVENTS.has(ev), true);
  }
});
