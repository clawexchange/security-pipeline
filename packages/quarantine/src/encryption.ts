import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedPayload, EncryptionService } from './types.js';

const ALGORITHM = 'aes-256-gcm';
const DEK_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits - recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Create an encryption service using AES-256-GCM with envelope encryption.
 *
 * Uses a two-layer key scheme:
 * 1. A per-record Data Encryption Key (DEK) encrypts the content
 * 2. The master key encrypts (wraps) the DEK
 *
 * This allows key rotation without re-encrypting stored content.
 */
export function createEncryptionService(masterKeyBase64: string): EncryptionService {
  const masterKey = Buffer.from(masterKeyBase64, 'base64');

  if (masterKey.length !== 32) {
    throw new Error(
      `Master key must be exactly 32 bytes (256 bits). Got ${masterKey.length} bytes. ` +
      'Provide a base64-encoded 32-byte key.'
    );
  }

  return {
    encrypt(plaintext: Buffer): EncryptedPayload {
      // Generate a random DEK for this record
      const dek = randomBytes(DEK_LENGTH);

      // Encrypt the content with the DEK
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, dek, iv, { authTagLength: AUTH_TAG_LENGTH });
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Wrap (encrypt) the DEK with the master key
      const dekIv = randomBytes(IV_LENGTH);
      const dekCipher = createCipheriv(ALGORITHM, masterKey, dekIv, { authTagLength: AUTH_TAG_LENGTH });
      const encryptedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
      const dekAuthTag = dekCipher.getAuthTag();

      return { ciphertext, iv, authTag, encryptedDek, dekIv, dekAuthTag };
    },

    decrypt(payload: EncryptedPayload): Buffer {
      // Unwrap the DEK using the master key
      const dekDecipher = createDecipheriv(ALGORITHM, masterKey, payload.dekIv, { authTagLength: AUTH_TAG_LENGTH });
      dekDecipher.setAuthTag(payload.dekAuthTag);
      const dek = Buffer.concat([dekDecipher.update(payload.encryptedDek), dekDecipher.final()]);

      // Decrypt the content with the DEK
      const decipher = createDecipheriv(ALGORITHM, dek, payload.iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAuthTag(payload.authTag);
      const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);

      return plaintext;
    },
  };
}
