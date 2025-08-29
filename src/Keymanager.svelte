<script lang="ts">
import { onMount } from 'svelte';
import { decodeBech32Key, getXOnlyPublicKey, signSchnorr, verifySchnorr, sha256, hexToBytes, ctEqualBytes } from './secp256k1.js';
import { openDB } from 'idb';

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
const TOKEN_VALIDITY_MS = 24 * 60 * 60 * 1000;

let db: IDBDatabase;

function utf8Encode(str: string): Uint8Array { return new TextEncoder().encode(str); }

async function loadTokenFromDB(): Promise<boolean> {
  try {
    if (!db) db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(USERDB_STORE, 'readonly');
      const store = tx.objectStore(USERDB_STORE);
      const req = store.get(USERDB_KEY);
      req.onerror = () => reject(req.error);
      req.onsuccess = async () => {
        const token: LoginToken | undefined = req.result;
        if (!token) return resolve(false);

        if (Date.now() - token.timestamp > TOKEN_VALIDITY_MS) return resolve(false);

        const msg = utf8Encode(token.publicKey + token.timestamp.toString());
        const msgHash = await sha256(msg);
        const valid = await verifySchnorr(token.signature, msgHash, token.publicKey);
        if (!valid) return resolve(false);

        publicKeyHex = token.publicKey;
        privateKeyHex = null;
        keysLoaded = false;
        resolve(true);
      };
    });
  } catch (e) {
    console.error('Failed to load token', e);
    return false;
  }
}

async function saveTokenToDB(token: LoginToken) {
  if (!db) db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(USERDB_STORE, 'readwrite');
    const store = tx.objectStore(USERDB_STORE);
    const req = store.put(token, USERDB_KEY);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

async function clearTokenFromDB() {
  if (!db) db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(USERDB_STORE, 'readwrite');
    const store = tx.objectStore(USERDB_STORE);
    const req = store.delete(USERDB_KEY);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
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
  db = await openDB();
  await loadTokenFromDB();
});
</script>