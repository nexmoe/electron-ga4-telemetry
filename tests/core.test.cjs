const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCampaign, safeScreen, cleanParams, toGtagCampaign, localDay } = require('../dist/core.js');

test('UTM parser drops unsafe values and unrecognized query parameters', () => {
  const campaign = parseCampaign('myapp://open?utm_source=github&utm_medium=release&utm_campaign=v2&secret=abc&utm_term=john%40example.com');
  assert.deepEqual(campaign, { utm_source: 'github', utm_medium: 'release', utm_campaign: 'v2' });
  assert.equal(parseCampaign('myapp://open?notutm=true'), undefined);
  assert.deepEqual(toGtagCampaign(campaign), {
    campaign_source: 'github', campaign_medium: 'release', campaign_name: 'v2',
  });
});

test('route scrubbing never reports full dynamic paths', () => {
  assert.equal(safeScreen('/'), 'home');
  assert.equal(safeScreen('/index.html'), 'home');
  assert.equal(safeScreen('/downloads'), 'downloads');
  assert.equal(safeScreen('/users/alice@example.com'), 'users/detail');
  assert.equal(safeScreen('/downloads/history?token=secret'), 'downloads/detail');
  assert.equal(safeScreen('/private/7d671fdb-ae9b-4672-a0f1-b2268d3a9995'), 'private/detail');
});

test('string payload filtering drops PII, URLs, local paths and NaN', () => {
  assert.deepEqual(cleanParams({
    feature_name: 'video_download', count: 3, flag: true, email: 'john@example.com',
    file: 'C:\\Users\\john', url: 'https://secret.example', invalid: NaN,
    illegal_parameter_name_that_is_bigger_than_forty_chars: 1,
  }), { feature_name: 'video_download', count: 3, flag: true });
});

test('day keys are deterministic for the runtime local timezone', () => {
  assert.equal(localDay(new Date(2026, 9, 22, 12, 30).getTime()), '2026-10-22');
});
