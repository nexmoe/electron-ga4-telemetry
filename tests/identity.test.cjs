const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const Module = require('node:module');
const { IdentityStore } = require('../dist/identity.js');

test('a failed atomic replacement preserves the previously saved identity and cleans temporary files', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'ga4-atomic-'));
  const path = require.resolve('../dist/identity.js');
  try {
    const original = new IdentityStore(directory, 'stream/partition', () => {});
    original.resolve('installation', '123.456');
    delete require.cache[path];
    const previous = Module._load;
    Module._load = function (name, ...args) {
      if (name === 'node:fs') return { ...fs, renameSync() { throw new Error('Simulated write interruption'); } };
      return previous.call(this, name, ...args);
    };
    let FaultyStore;
    try { FaultyStore = require(path).IdentityStore; }
    finally { Module._load = previous; delete require.cache[path]; }
    let errors = 0;
    const interrupted = new FaultyStore(directory, 'stream/partition', () => { errors++; });
    assert.equal(interrupted.get('installation'), '123.456');
    interrupted.set('installation', '321.654');
    assert.equal(interrupted.status, 'memory');
    assert.equal(errors, 1);
    const restarted = new IdentityStore(directory, 'stream/partition', () => {});
    assert.equal(restarted.get('installation'), '123.456');
    assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp')), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('separate collector partitions and identity keys cannot reuse each other\'s persisted identity', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'ga4-scoped-'));
  try {
    const first = new IdentityStore(directory, 'stream/first-partition', () => {});
    const second = new IdentityStore(directory, 'stream/second-partition', () => {});
    first.resolve('one', '123.456');
    assert.equal(second.resolve('one', '321.654'), '321.654');
    assert.equal(first.resolve('two', '987.654'), '987.654');
    assert.equal(first.get('one'), '123.456');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
