// BucketStore.js
import { writable } from 'svelte/store';

/**
 * bucketStore: list of buckets with number and hash
 * Example: [{ bucket_number: 1, hash: 'abc123' }, { bucket_number: 2, hash: 'def456' }]
 */
export const bucketStore = writable({
  '1': 'abc123',
  '2': 'def456',
  // ...
});

/**
 * uuidStore: just the UUIDs per bucket
 * Example: { 1: ['uuid1','uuid2'], 2: ['uuid3'] }
 */
export const uuidStore = writable({
  'd1': ['uuid1', 'uuid2'],
  'd2': ['uuid3', 'uuid4'],
  // ...
});

/**
 * recordStore: full records in memory
 * Example record:
 * { 
 *   uuid: 'uuid1',
 *   timestamp: '2025-08-27T08:00:00Z',
 *   bucket_number: 1,
 *   creator_npub: 'npub1xyz...',
 *   text: 'Some mission text',
 *   link: 'https://...',
 *   latitude: 12.34,
 *   longitude: 56.78,
 *   hash: 'sha256hash',
 *   signature: 'ed25519signature'
 * }
 */
export const recordStore = writable({
   
    'uuid1': {
      timestamp: '2025-08-27T08:00:00Z',
      bucket_number: 1,
      creator_npub: 'npub1xyz...',
      text: 'Some mission text',
      link: 'https://...',
      latitude: 12.34,
      longitude: 56.78,
      hash: 'sha256hash',
      signature: 'ed25519signature'
    },
  'uuid2': {
      timestamp: '2025-08-27T08:00:00Z',
      bucket_number: 1,
      creator_npub: 'npub1xyz...',
      text: 'Some mission text',
      link: 'https://...',
      latitude: 12.34,
      longitude: 56.78,
      hash: 'sha256hash',
      signature: 'ed25519signature'
    },
  'uuid3': {
      timestamp: '2025-08-27T08:00:00Z',
      bucket_number: 1,
      creator_npub: 'npub1xyz...',
      text: 'Some mission text',
      link: 'https://...',
      latitude: 12.34,
      longitude: 56.78,
      hash: 'sha256hash',
      signature: 'ed25519signature'
    },
});