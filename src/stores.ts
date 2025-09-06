import { writable } from 'svelte/store';

// Store for record hash map: UUID -> hash string
export const hashMapStore = writable<Record<string, string>>({});
// Store for the current Merkle root hash
export const merkleRoot = writable<string>('');
