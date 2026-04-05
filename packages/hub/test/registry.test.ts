import assert from 'node:assert/strict';
import test from 'node:test';
import { diffRemovedPlayerIds, filterLegacyTokensByExistingNodes } from '../src/store/registry';

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

test('diffRemovedPlayerIds returns players missing from the latest mirrored manifest', () => {
  assert.deepEqual(
    diffRemovedPlayerIds(
      ['node-a-insta-1', 'node-a-insta-2', 'node-a-admax-1'],
      ['node-a-insta-1', 'node-a-admax-1'],
    ),
    ['node-a-insta-2'],
  );
});

test('diffRemovedPlayerIds treats an empty incoming manifest as removing every current player', () => {
  assert.deepEqual(
    diffRemovedPlayerIds(
      ['node-b-insta-1', 'node-b-insta-2'],
      [],
    ),
    ['node-b-insta-1', 'node-b-insta-2'],
  );
});
