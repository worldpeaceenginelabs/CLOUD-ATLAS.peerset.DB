import * as secp from '@noble/secp256k1';

const { schnorr } = secp;


// secp256k1.ts
export async function sha256(msg: string | Uint8Array): Promise<string> {
  let data: Uint8Array;

  if (typeof msg === 'string') {
    // Encode string as UTF-8
    data = new TextEncoder().encode(msg);
  } else {
    // Already Uint8Array
    data = msg;
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  // Convert buffer to hex
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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

// ---------------- Bech32 decoder (minimal, no deps) ----------------
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Decode(str: string) {
  const lowered = str.toLowerCase();
  const pos = lowered.lastIndexOf('1');
  if (pos < 1) throw new Error('Invalid Bech32 string');

  const data = lowered
    .slice(pos + 1)
    .split('')
    .map((c) => {
      const index = CHARSET.indexOf(c);
      if (index === -1) throw new Error('Invalid character in Bech32 string');
      return index;
    });

  return data;
}

// convert 5-bit words to 8-bit bytes
function fromWords(words: number[]): Uint8Array {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const w of words) {
    buffer = (buffer << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

// public export
export function decodeBech32Key(bech32Str: string): string {
  const words = bech32Decode(bech32Str);
  const bytes = fromWords(words);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}