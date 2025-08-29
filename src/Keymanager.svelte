<script lang="ts">
import { onMount } from 'svelte';
import { decodeBech32Key, getXOnlyPublicKey, signSchnorr, verifySchnorr, sha256, hexToBytes, ctEqualBytes } from './secp256k1.js';
import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';

interface LoginToken {
  v: 1;
  publicKey: string;    // x-only hex
  timestamp: number;
  signature: string;    // 64-byte hex
}

let npubInput = '';
let nsecInput = '';
let keysLoaded = false;
let publicKeyHex: string | null = null;
let privateKeyHex: string | null = null;
let loading = false;
let errorMsg = '';

const USERDB_STORE = 'userdb';
const USERDB_KEY = 'loginToken';
const DB_NAME = 'peerset';
const DB_VERSION = 1;
const TOKEN_VALIDITY_MS = 24 * 60 * 60 * 1000;

let db: IDBPDatabase | undefined;

function utf8Encode(str: string): Uint8Array { return new TextEncoder().encode(str); }

async function loadTokenFromDB(): Promise<boolean> {
  try {
    if (!db) db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(USERDB_STORE)) {
          db.createObjectStore(USERDB_STORE);
        }
      }
    });
    const tx = db.transaction(USERDB_STORE, 'readonly');
    const store = tx.objectStore(USERDB_STORE);
    const token = (await store.get(USERDB_KEY)) as LoginToken | undefined;
    await tx.done;
    if (!token) return false;
    if (Date.now() - token.timestamp > TOKEN_VALIDITY_MS) return false;
    const msg = utf8Encode(token.publicKey + token.timestamp.toString());
    const msgHash = await sha256(msg);
    const valid = await verifySchnorr(token.signature, msgHash, token.publicKey);
    if (!valid) return false;
    publicKeyHex = token.publicKey;
    privateKeyHex = null;
    keysLoaded = false;
    return true;
  } catch (e) {
    console.error('Failed to load token', e);
    return false;
  }
}

async function saveTokenToDB(token: LoginToken) {
  if (!db) db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(USERDB_STORE)) {
        db.createObjectStore(USERDB_STORE);
      }
    }
  });
  const tx = db.transaction(USERDB_STORE, 'readwrite');
  const store = tx.objectStore(USERDB_STORE);
  await store.put(token, USERDB_KEY);
  await tx.done;
}

async function clearTokenFromDB() {
  if (!db) db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(USERDB_STORE)) {
        db.createObjectStore(USERDB_STORE);
      }
    }
  });
  const tx = db.transaction(USERDB_STORE, 'readwrite');
  const store = tx.objectStore(USERDB_STORE);
  await store.delete(USERDB_KEY);
  await tx.done;
}

async function handleImport() {
  errorMsg = '';
  loading = true;

  try {
    const pubHex = decodeBech32Key(npubInput.trim()).toLowerCase();
    const privHex = decodeBech32Key(nsecInput.trim()).toLowerCase();

    const derivedPub = getXOnlyPublicKey(privHex).toLowerCase();

    if (!ctEqualBytes(hexToBytes(pubHex), hexToBytes(derivedPub))) {
      errorMsg = 'Public key does not match private key.';
      loading = false;
      return;
    }

    const timestamp = Date.now();
    const msg = utf8Encode(pubHex + timestamp.toString());
    const msgHash = await sha256(msg);

    const sig = await signSchnorr(msgHash, privHex);
    const valid = await verifySchnorr(sig, msgHash, pubHex);

    if (!valid) {
      errorMsg = 'Signature verification failed.';
      loading = false;
      return;
    }

    const token: LoginToken = { v: 1, publicKey: pubHex, timestamp, signature: sig };
    await saveTokenToDB(token);

    publicKeyHex = pubHex;
    privateKeyHex = privHex;
    keysLoaded = true;

  } catch (e: any) {
    errorMsg = 'Error importing keys: ' + e.message;
  } finally {
    loading = false;
  }
}

async function logout() {
  if (privateKeyHex) hexToBytes(privateKeyHex).fill(0);
  await clearTokenFromDB();
  publicKeyHex = null;
  privateKeyHex = null;
  keysLoaded = false;
  npubInput = '';
  nsecInput = '';
}

onMount(async () => {
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(USERDB_STORE)) {
        db.createObjectStore(USERDB_STORE);
      }
    }
  });
  await loadTokenFromDB();
});
</script>