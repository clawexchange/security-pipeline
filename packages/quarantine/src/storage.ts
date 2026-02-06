import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config, StorageClient } from './types.js';

/**
 * Create an S3-compatible storage client.
 * Works with both AWS S3 and MinIO.
 */
export function createStorageClient(config: S3Config): StorageClient {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region ?? 'us-east-1',
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    forcePathStyle: config.forcePathStyle ?? true,
  });

  const bucket = config.bucket;

  return {
    async upload(key: string, data: Buffer): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: data,
          ContentType: 'application/octet-stream',
        }),
      );
    },

    async download(key: string): Promise<Buffer> {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      if (!response.Body) {
        throw new Error(`Empty response body for key: ${key}`);
      }

      // Convert readable stream to Buffer
      const chunks: Uint8Array[] = [];
      const stream = response.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },

    async delete(key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    },

    async deleteMany(keys: string[]): Promise<void> {
      if (keys.length === 0) return;

      // S3 DeleteObjects supports max 1000 keys per request
      const batchSize = 1000;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: batch.map((k) => ({ Key: k })),
              Quiet: true,
            },
          }),
        );
      }
    },

    async getSignedUrl(key: string, expirySeconds: number): Promise<string> {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      return awsGetSignedUrl(client, command, { expiresIn: expirySeconds });
    },
  };
}
