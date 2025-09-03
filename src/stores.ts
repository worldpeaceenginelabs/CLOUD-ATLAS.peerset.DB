import { writable } from 'svelte/store';

export const recordStore = writable<Record<string, any>>({});
export const merkleRoot = writable('');
