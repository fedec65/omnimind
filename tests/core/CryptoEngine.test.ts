/**
 * CryptoEngine unit tests
 *
 * Tests AES-256-GCM encryption/decryption round-trips and key derivation.
 */

import { describe, it, expect } from 'vitest';
import { CryptoEngine } from '../../src/core/CryptoEngine.js';

describe('CryptoEngine', () => {
  it('should round-trip encrypt and decrypt', () => {
    const crypto = new CryptoEngine();
    const plaintext = 'User prefers GraphQL over REST for all new APIs';

    const encrypted = crypto.encrypt(plaintext);
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;

    const decrypted = crypto.decrypt(encrypted.value);
    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) return;

    expect(decrypted.value).toBe(plaintext);
  });

  it('should produce different ciphertexts for same plaintext', () => {
    const crypto = new CryptoEngine();
    const plaintext = 'Same text';

    const e1 = crypto.encrypt(plaintext);
    const e2 = crypto.encrypt(plaintext);
    expect(e1.ok && e2.ok).toBe(true);
    if (!e1.ok || !e2.ok) return;

    // IVs should be different (random)
    expect(e1.value.iv).not.toBe(e2.value.iv);
    expect(e1.value.ciphertext).not.toBe(e2.value.ciphertext);
  });

  it('should fail decryption with wrong auth tag', () => {
    const crypto = new CryptoEngine();
    const encrypted = crypto.encrypt('test');
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;

    const tampered = {
      ...encrypted.value,
      authTag: 'AAAAAAAAAAAAAAAAAAAAAA==', // invalid auth tag
    };

    const decrypted = crypto.decrypt(tampered);
    expect(decrypted.ok).toBe(false);
  });

  it('should fail decryption with different salt', () => {
    const crypto1 = new CryptoEngine();
    const encrypted = crypto1.encrypt('test');
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;

    const crypto2 = new CryptoEngine();
    const decrypted = crypto2.decrypt(encrypted.value);
    expect(decrypted.ok).toBe(false);
  });

  it('should encrypt empty string', () => {
    const crypto = new CryptoEngine();
    const encrypted = crypto.encrypt('');
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;

    const decrypted = crypto.decrypt(encrypted.value);
    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) return;
    expect(decrypted.value).toBe('');
  });

  it('should be fast (< 5ms for 1KB text)', () => {
    const crypto = new CryptoEngine();
    const plaintext = 'A'.repeat(1000);

    const start = performance.now();
    const encrypted = crypto.encrypt(plaintext);
    const encryptTime = performance.now() - start;

    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;

    const start2 = performance.now();
    crypto.decrypt(encrypted.value);
    const decryptTime = performance.now() - start2;

    expect(encryptTime).toBeLessThan(5);
    expect(decryptTime).toBeLessThan(5);
  });
});
