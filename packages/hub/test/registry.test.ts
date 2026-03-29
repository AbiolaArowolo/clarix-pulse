import assert from 'node:assert/strict';
import test from 'node:test';
import { filterLegacyTokensByExistingNodes } from '../src/store/registry';

test('filterLegacyTokensByExistingNodes skips tokens for unknown nodes', () => {
  const legacyTokens = [
    { nodeId: 'known-node', token: 'token-a' },
    { nodeId: 'missing-node', token: 'token-b' },
  ];

  assert.deepEqual(
    filterLegacyTokensByExistingNodes(legacyTokens, ['known-node']),
    [{ nodeId: 'known-node', token: 'token-a' }],
  );
});

test('filterLegacyTokensByExistingNodes keeps tokens for nodes already in the registry', () => {
  const legacyTokens = [
    { nodeId: 'node-a', token: 'token-a' },
    { nodeId: 'node-b', token: 'token-b' },
  ];

  assert.deepEqual(
    filterLegacyTokensByExistingNodes(legacyTokens, ['node-a', 'node-b']),
    legacyTokens,
  );
});
