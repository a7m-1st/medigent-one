import { env } from './env';

let aesKey: CryptoKey | null = null;

async function getAesKey(): Promise<CryptoKey | null> {
  const encryptionKey = env.VITE_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return null;
  }

  if (aesKey) {
    return aesKey;
  }

  try {
    const keyBytes = Uint8Array.from(atob(encryptionKey), (c) => c.charCodeAt(0));
    aesKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    return aesKey;
  } catch {
    return null;
  }
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getAesKey();
  if (!key) {
    return plaintext;
  }

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    plaintextBytes
  );

  const combined = new Uint8Array(nonce.length + ciphertext.byteLength);
  combined.set(nonce);
  combined.set(new Uint8Array(ciphertext), nonce.length);

  return btoa(String.fromCharCode(...combined));
}

export async function isEncrypted(value: string): Promise<boolean> {
  const key = await getAesKey();
  if (!key) {
    return false;
  }

  try {
    const combined = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    if (combined.length < 12) {
      return false;
    }
    const nonce = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      encrypted
    );
    return true;
  } catch {
    return false;
  }
}
