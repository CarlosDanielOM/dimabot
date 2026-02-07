import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
    region: process.env.S3_REGION!,
    endpoint: `https://${process.env.S3_REGION!}.${process.env.S3_ENDPOINT!}`,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!
    }
});

const BUCKET = process.env.S3_BUCKET!;
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL || `https://${BUCKET}.${process.env.S3_REGION!}.${process.env.S3_ENDPOINT!}`;

export async function uploadTriggerFileToS3(
    channelID: string,
    stream: Buffer | string,
    mimeType: string,
    key: string
): Promise<string> {
    try {
        const command = new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: stream,
            ContentType: mimeType,
            ACL: 'public-read',
            CacheControl: 'public, max-age=31536000'
        });

        await s3Client.send(command);
        return `${S3_PUBLIC_URL}/${key}`;
    } catch (error) {
        console.error('Error uploading trigger file to S3:', error);
        throw error;
    }
}

export async function deleteTriggerFileFromS3(channelID: string, key: string): Promise<boolean> {
    try {
        const command = new DeleteObjectCommand({
            Bucket: BUCKET,
            Key: key
        });

        await s3Client.send(command);
        return true;
    } catch (error) {
        console.error('Error deleting trigger file from S3:', error);
        throw error;
    }
}
