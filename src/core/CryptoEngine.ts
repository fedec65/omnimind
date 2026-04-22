/**
 * CryptoEngine — AES-256-GCM encryption at rest for memory content
 *
 * Key derivation: HKDF-SHA256(machineFingerprint + optionalPassphrase, salt)
 * Encryption: AES-256-GCM with random 16-byte IV and 16-byte authTag
 *
 * Embeddings are NOT encrypted (they are not sensitive text content).
 * All operations are synchronous and local — zero external dependencies.
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'crypto';
import { hostname, userInfo } from 'os';
import { type Result, ok, err } from './types.js';

/** Encrypted blob structure */
export interface EncryptedBlob {
  readonly iv: string; // base64
  readonly authTag: string; // base64
  readonly ciphertext: string; // base64
  readonly salt: string; // base64
}

/** Configuration for CryptoEngine */
export interface CryptoEngineConfig {
  /** Optional user passphrase to strengthen key derivation */
  passphrase?: string | undefined;
  /** Optional salt (generated randomly if not provided) */
  salt?: Buffer | undefined;
}

/**
 * Local encryption engine for memory content.
 *
 * Usage:
 * ```typescript
 * const crypto = new CryptoEngine();
 * const encrypted = crypto.encrypt('Sensitive memory content');
 * const decrypted = crypto.decrypt(encrypted);
 * ```
 */
export class CryptoEngine {
  private readonly key: Buffer;
  private readonly salt: Buffer;

  constructor(config: CryptoEngineConfig = {}) {
    this.salt = config.salt ?? randomBytes(32);
    const machineId = getMachineFingerprint();
    const inputKey = createHash('sha256')
      .update(machineId + (config.passphrase ?? ''))
      .digest();
    this.key = Buffer.from(hkdfSync('sha256', inputKey, this.salt, 'omnimind-v1', 32));
  }

  /**
   * Encrypt plaintext to AES-256-GCM ciphertext.
   *
   * Latency target: < 5ms for texts under 1KB
   */
  encrypt(plaintext: string): Result<EncryptedBlob> {
    try {
      const iv = randomBytes(16);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return ok({
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext: encrypted.toString('base64'),
        salt: this.salt.toString('base64'),
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Decrypt AES-256-GCM ciphertext to plaintext.
   */
  decrypt(blob: EncryptedBlob): Result<string> {
    try {
      const iv = Buffer.from(blob.iv, 'base64');
      const authTag = Buffer.from(blob.authTag, 'base64');
      const ciphertext = Buffer.from(blob.ciphertext, 'base64');

      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      return ok(decrypted.toString('utf8'));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Get the salt used for key derivation (for persistence) */
  getSalt(): string {
    return this.salt.toString('base64');
  }
}

/** Generate a stable machine fingerprint */
function getMachineFingerprint(): string {
  // Combine hostname, user info, and CPU architecture for a stable fingerprint
  // This is not cryptographically secure but provides stability across restarts
  const data = `${hostname()}-${userInfo().username}-${process.arch}-${process.platform}`;
  return createHash('sha256').update(data).digest('hex').substring(0, 32);
}
