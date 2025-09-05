import { writable } from 'svelte/store';

// Store for record hashes: UUID -> hash string
export const recordStore = writable<Record<string, string>>({});
// Store for the current Merkle root hash
export const merkleRoot = writable<string>('');
