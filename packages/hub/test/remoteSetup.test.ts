import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRemoteSetupDraft } from '../src/config/remoteSetup';

test('normalizeRemoteSetupDraft prefers existing Pulse config details from discovery metadata', () => {
  const draft = normalizeRemoteSetupDraft({
    node_id: '',
    node_name: '',
    site_id: '',
    hub_url: 'https://monitor.example.com',
    machine: {
      hostname: 'CASPEN-STUDIO-PC',
    },
    discovery: {
      existing_pulse_config: {
        node_id: 'caspen-main',
        node_name: 'Caspen Main',
        site_id: 'caspen-main',
        hub_url: 'https://pulse.clarixtech.com',
      },
    },
    players: [
      {
        player_id: 'caspen-main-insta-1',
        playout_type: 'insta',
        paths: {
          shared_log_dir: 'C:\\Program Files\\Indytek\\Insta log',
          instance_root: 'C:\\Program Files\\Indytek\\Insta Playout\\Settings',
        },
      },
    ],
  }, 'https://pulse.clarixtech.com');

  assert.equal(draft.nodeId, 'caspen-main');
  assert.equal(draft.nodeName, 'Caspen Main');
  assert.equal(draft.siteId, 'caspen-main');
  assert.equal(draft.hubUrl, 'https://pulse.clarixtech.com');
  assert.equal(draft.players.length, 1);
});

test('normalizeRemoteSetupDraft replaces the sample hub URL with the active hub origin', () => {
  const draft = normalizeRemoteSetupDraft({
    node_id: 'studio-a',
    node_name: 'Studio A',
    site_id: 'studio-a',
    hub_url: 'https://monitor.example.com',
    players: [],
  }, 'https://pulse.clarixtech.com');

  assert.equal(draft.hubUrl, 'https://pulse.clarixtech.com');
});
