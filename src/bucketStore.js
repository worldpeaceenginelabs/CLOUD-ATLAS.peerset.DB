import { writable } from 'svelte/store';

// Hashes per bucket
export const bucketStore = writable({
  'qd1': 'abc123',
  'qd2': 'def456',
  // ...
}); 

// UUIDs per bucket
export const uuidStore = writable({
  'qd1': ['uuid1', 'uuid2'],
  'qd2': ['uuid3', 'uuid4'],
  // ...
});

// Full records by UUID
export const recordStore = writable({
  'uuid1': { data: '...', bucketId: 'qd1' },
  'uuid2': { data: '...', bucketId: 'qd1' },
  'uuid3': { data: '...', bucketId: 'qd2' },
});
