import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createEncryptionService } from './encryption.js';

// Generate a valid 32-byte master key
const masterKey = randomBytes(32).toString('base64');

describe('EncryptionService', () => {
  describe('createEncryptionService', () => {
    it('should create an encryption service with a valid key', () => {
      const service = createEncryptionService(masterKey);
      expect(service).toBeDefined();
      expect(typeof service.encrypt).toBe('function');
      expect(typeof service.decrypt).toBe('function');
    });

    it('should reject a key that is not 32 bytes', () => {
      const shortKey = randomBytes(16).toString('base64');
      expect(() => createEncryptionService(shortKey)).toThrow('Master key must be exactly 32 bytes');
    });

    it('should reject an empty key', () => {
      expect(() => createEncryptionService('')).toThrow('Master key must be exactly 32 bytes');
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    const service = createEncryptionService(masterKey);

    it('should encrypt and decrypt a simple string', () => {
      const plaintext = Buffer.from('Hello, World!', 'utf-8');
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted.toString('utf-8')).toBe('Hello, World!');
    });

    it('should encrypt and decrypt an empty buffer', () => {
      const plaintext = Buffer.alloc(0);
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted.length).toBe(0);
    });

    it('should encrypt and decrypt large content', () => {
      const plaintext = randomBytes(100_000);
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('should encrypt and decrypt unicode content', () => {
      const plaintext = Buffer.from('日本語テスト 🎉 Ñoño', 'utf-8');
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted.toString('utf-8')).toBe('日本語テスト 🎉 Ñoño');
    });

    it('should produce different ciphertexts for the same plaintext', () => {
      const plaintext = Buffer.from('same content', 'utf-8');
      const encrypted1 = service.encrypt(plaintext);
      const encrypted2 = service.encrypt(plaintext);

      // Different IVs and DEKs mean different ciphertexts
      expect(encrypted1.ciphertext.equals(encrypted2.ciphertext)).toBe(false);
      expect(encrypted1.iv.equals(encrypted2.iv)).toBe(false);
    });

    it('should return proper payload structure', () => {
      const plaintext = Buffer.from('test', 'utf-8');
      const encrypted = service.encrypt(plaintext);

      expect(Buffer.isBuffer(encrypted.ciphertext)).toBe(true);
      expect(Buffer.isBuffer(encrypted.iv)).toBe(true);
      expect(Buffer.isBuffer(encrypted.authTag)).toBe(true);
      expect(Buffer.isBuffer(encrypted.encryptedDek)).toBe(true);
      expect(Buffer.isBuffer(encrypted.dekIv)).toBe(true);
      expect(Buffer.isBuffer(encrypted.dekAuthTag)).toBe(true);

      // IV should be 12 bytes (96 bits)
      expect(encrypted.iv.length).toBe(12);
      expect(encrypted.dekIv.length).toBe(12);

      // Auth tags should be 16 bytes (128 bits)
      expect(encrypted.authTag.length).toBe(16);
      expect(encrypted.dekAuthTag.length).toBe(16);
    });
  });

  describe('tampering detection', () => {
    const service = createEncryptionService(masterKey);

    it('should fail to decrypt with tampered ciphertext', () => {
      const plaintext = Buffer.from('sensitive data', 'utf-8');
      const encrypted = service.encrypt(plaintext);

      // Tamper with ciphertext
      encrypted.ciphertext[0] = (encrypted.ciphertext[0]! + 1) % 256;

      expect(() => service.decrypt(encrypted)).toThrow();
    });

    it('should fail to decrypt with tampered auth tag', () => {
      const plaintext = Buffer.from('sensitive data', 'utf-8');
      const encrypted = service.encrypt(plaintext);

      // Tamper with auth tag
      encrypted.authTag[0] = (encrypted.authTag[0]! + 1) % 256;

      expect(() => service.decrypt(encrypted)).toThrow();
    });

    it('should fail to decrypt with a different master key', () => {
      const plaintext = Buffer.from('sensitive data', 'utf-8');
      const encrypted = service.encrypt(plaintext);

      const otherKey = randomBytes(32).toString('base64');
      const otherService = createEncryptionService(otherKey);

      expect(() => otherService.decrypt(encrypted)).toThrow();
    });

    it('should fail to decrypt with tampered DEK auth tag', () => {
      const plaintext = Buffer.from('sensitive data', 'utf-8');
      const encrypted = service.encrypt(plaintext);

      // Tamper with DEK auth tag
      encrypted.dekAuthTag[0] = (encrypted.dekAuthTag[0]! + 1) % 256;

      expect(() => service.decrypt(encrypted)).toThrow();
    });
  });
});
