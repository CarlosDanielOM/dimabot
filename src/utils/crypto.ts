import crypto from 'crypto';

const ALGORITHM = 'aes-256-ctr';
if(!process.env.SECRET_KEY) throw new Error('SECRET_KEY is not set');
const SECRET_KEY = Buffer.from(process.env.SECRET_KEY!.padEnd(32), 'utf-8');

export function encrypt(text: string): { iv: string, content: string } {
    if(!text) return { iv: '', content: '' };
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

    return {
        iv: iv.toString('hex'),
        content: encrypted.toString('hex')
    }
}

export function decrypt(hash: { iv: string, content: string }): string | null {
    if(!hash || !hash.iv || !hash.content) return null;

    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, Buffer.from(hash.iv, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(hash.content, 'hex')), decipher.final()]);

    return decrypted.toString();
}