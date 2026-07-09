const test = require('node:test');
const assert = require('node:assert/strict');
const { isTargetCoveredByScope } = require('../utils/scope');

test('exact IP match', () => {
  assert.equal(isTargetCoveredByScope('10.0.0.5', '10.0.0.5'), true);
  assert.equal(isTargetCoveredByScope('10.0.0.6', '10.0.0.5'), false);
});

test('CIDR match', () => {
  assert.equal(isTargetCoveredByScope('10.0.0.42', '10.0.0.0/24'), true);
  assert.equal(isTargetCoveredByScope('10.0.1.42', '10.0.0.0/24'), false);
  assert.equal(isTargetCoveredByScope('10.0.0.1', '10.0.0.1/32'), true);
  assert.equal(isTargetCoveredByScope('10.0.0.2', '10.0.0.1/32'), false);
});

test('exact domain match', () => {
  assert.equal(isTargetCoveredByScope('example.nl', 'example.nl'), true);
});

test('bare domain covers subdomains', () => {
  assert.equal(isTargetCoveredByScope('shop.example.nl', 'example.nl'), true);
  assert.equal(isTargetCoveredByScope('evilexample.nl', 'example.nl'), false);
});

test('wildcard domain covers subdomains only', () => {
  assert.equal(isTargetCoveredByScope('shop.example.nl', '*.example.nl'), true);
  assert.equal(isTargetCoveredByScope('example.nl', '*.example.nl'), true);
  assert.equal(isTargetCoveredByScope('shop.other.nl', '*.example.nl'), false);
});

test('multiple entries, comma/newline/semicolon separated', () => {
  const scope = '10.0.0.0/24, example.nl\n192.168.1.5;*.internal.nl';
  assert.equal(isTargetCoveredByScope('10.0.0.9', scope), true);
  assert.equal(isTargetCoveredByScope('sub.example.nl', scope), true);
  assert.equal(isTargetCoveredByScope('192.168.1.5', scope), true);
  assert.equal(isTargetCoveredByScope('foo.internal.nl', scope), true);
  assert.equal(isTargetCoveredByScope('203.0.113.1', scope), false);
});

test('empty or garbage scope never matches', () => {
  assert.equal(isTargetCoveredByScope('10.0.0.5', ''), false);
  assert.equal(isTargetCoveredByScope('10.0.0.5', null), false);
  assert.equal(isTargetCoveredByScope('', '10.0.0.5'), false);
});

test('is case-insensitive for domains', () => {
  assert.equal(isTargetCoveredByScope('Shop.Example.NL', 'example.nl'), true);
});
