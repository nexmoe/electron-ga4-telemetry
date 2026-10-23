const test = require('node:test');
const assert = require('node:assert/strict');
const { Window } = require('happy-dom');
const { installEnhancedMeasurement } = require('../dist/enhanced.js');

test('user receives native form metadata without field values', () => {
  // Given an ordinary form containing a private field value.
  const window = new Window({ url: 'https://desktop.example.com/' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    history: window.history,
  });
  const events = [];
  const stop = installEnhancedMeasurement(
    { forms: true },
    window.location.origin,
    () => 'home',
    (name, params) => events.push({ name, params }),
  );
  const form = document.createElement('form');
  form.id = 'subscribe';
  form.name = 'newsletter';
  form.action = 'https://example.com/subscribe';
  const input = document.createElement('input');
  input.value = 'private@example.com';
  const button = document.createElement('button');
  button.textContent = 'Subscribe';
  form.append(input, button);
  document.body.append(form);
  // When the user interacts and submits with the real form submitter.
  input.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
  form.dispatchEvent(
    new window.SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: button,
    }),
  );
  // Then GA4 receives standard form metadata, never the field value.
  assert.deepEqual(events, [
    {
      name: 'form_start',
      params: {
        form_id: 'subscribe',
        form_name: 'newsletter',
        form_destination: 'https://example.com/subscribe',
      },
    },
    {
      name: 'form_submit',
      params: {
        form_id: 'subscribe',
        form_name: 'newsletter',
        form_destination: 'https://example.com/subscribe',
        form_submit_text: 'Subscribe',
      },
    },
  ]);
  stop();
  window.happyDOM.abort();
});

test('user opening a download through DOM and the operating system is measured once', () => {
  // Given both DOM and native Electron notifications can describe the same action.
  const { createLinkMeasurement } = require('../dist/links.js');
  const events = [];
  const measurement = createLinkMeasurement(
    { outboundClicks: true, fileDownloads: true },
    'https://desktop.example.com',
    (...args) => events.push(args),
  );
  // When one user action first clicks an anchor, then starts the native download.
  measurement.record('click', 'https://files.example.com/report.pdf', 'dom');
  measurement.record(
    'download',
    'https://files.example.com/report.pdf',
    'native',
    'report.pdf',
  );
  measurement.record('click', 'https://files.example.com/report.pdf', 'native');
  // Then there is one download and one outbound click, preserving full metadata.
  assert.equal(events.filter(([name]) => name === 'file_download').length, 1);
  assert.equal(events.filter(([name]) => name === 'click').length, 1);
  assert.equal(events[0][1].file_name, 'report.pdf');
});

test('user native downloads retain extensionless response filenames and redacted URLs', () => {
  // Given the desktop app explicitly chooses the redacted policy.
  const { createLinkMeasurement } = require('../dist/links.js');
  const events = [];
  const measurement = createLinkMeasurement(
    { privacy: 'redacted', fileDownloads: true, outboundClicks: true },
    'https://desktop.example.com',
    (...args) => events.push(args),
  );
  // When Electron supplies the server filename and an external browser is opened.
  measurement.record(
    'download',
    'https://files.example.com/download?token=secret',
    'native',
    'invoice.pdf',
  );
  measurement.record(
    'click',
    'https://example.com/path?token=secret',
    'native',
  );
  measurement.record('click', 'file:///private/secret.pdf', 'native');
  // Then the filename identifies only the extension and external URLs contain only the origin.
  assert.deepEqual(events, [
    ['file_download', { file_extension: 'pdf' }],
    [
      'click',
      {
        outbound: true,
        link_domain: 'example.com',
        link_url: 'https://example.com',
      },
    ],
  ]);
});
