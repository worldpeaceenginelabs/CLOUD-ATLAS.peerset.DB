import * as secp from '@noble/secp256k1';
const { schnorr } = secp;

export async function sha256(msg: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', msg);
  return new Uint8Array(hashBuffer);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Constant-time comparison
export function ctEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) res |= a[i] ^ b[i];
  return res === 0;
}

// --- Schnorr key operations ---

// x-only public key (32 bytes hex) from private key
export function getXOnlyPublicKey(privHex: string): string {
  privHex = privHex.toLowerCase();
  const pubBytes = schnorr.getPublicKey(privHex);
  return bytesToHex(pubBytes);
}

// Sign 32-byte hash
export async function signSchnorr(msgHash: Uint8Array, privHex: string): Promise<string> {
  privHex = privHex.toLowerCase();
  const sigBytes = await schnorr.sign(msgHash, privHex);
  const sigHex = bytesToHex(sigBytes);
  sigBytes.fill(0);
  return sigHex;
}

// Verify signature against 32-byte hash
export async function verifySchnorr(sigHex: string, msgHash: Uint8Array, pubHex: string): Promise<boolean> {
  sigHex = sigHex.toLowerCase();
  pubHex = pubHex.toLowerCase();
  const sigBytes = hexToBytes(sigHex);
  const pubBytes = hexToBytes(pubHex);
  const ok = await schnorr.verify(sigBytes, msgHash, pubBytes);
  sigBytes.fill(0);
  pubBytes.fill(0);
  return ok;
}
