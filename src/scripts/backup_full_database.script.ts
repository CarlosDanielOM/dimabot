import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { getMongoDBConnection } from '../utils/databases/mongodb.database.js';

const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function getArgValue(flag: string): string | null {
    const index = process.argv.indexOf(flag);
    if (index === -1) {
        return null;
    }

    return process.argv[index + 1] || null;
}

async function run(): Promise<void> {
    const execute = process.argv.includes('--execute');
    const backupRoot = getArgValue('--out-dir') || path.resolve(process.cwd(), '.opencode', 'backups');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(backupRoot, `full-db-${timestamp}`);
    const archivePath = path.join(backupDir, 'mongo.archive.gz');

    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is not set');
    }

    fs.mkdirSync(backupDir, { recursive: true });

    console.log('[backup] target directory:', backupDir);
    console.log('[backup] archive path:', archivePath);

    if (!execute) {
        console.log('[backup] dry-run complete. Re-run with --execute to create the backup.');
        console.log('[backup] command preview:');
        console.log(`mongodump --uri "<redacted>" --archive="${archivePath}" --gzip`);
        console.log('[backup] fallback preview: NDJSON export per collection if mongodump is unavailable.');
        return;
    }

    let backupType = 'mongodump';
    let backupDetails: Record<string, unknown> = { archivePath };

    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn('mongodump', [
                `--uri=${process.env.MONGO_URI}`,
                `--archive=${archivePath}`,
                '--gzip'
            ], {
                stdio: 'inherit'
            });

            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }

                reject(new Error(`mongodump exited with code ${code}`));
            });
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            throw error;
        }

        console.log('[backup] mongodump not available, falling back to NDJSON export');
        const exportDir = path.join(backupDir, 'collections');
        fs.mkdirSync(exportDir, { recursive: true });

        await getMongoDBConnection('backup_full_database');

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('MongoDB connection did not expose a database handle');
        }

        const collections = await db.listCollections({}, { nameOnly: true }).toArray();
        const collectionSummaries: Array<{ name: string; count: number; file: string }> = [];

        for (const collectionInfo of collections) {
            const collectionName = collectionInfo.name;
            if (!collectionName || collectionName.startsWith('system.')) {
                continue;
            }

            const fileName = `${collectionName}.ndjson`;
            const filePath = path.join(exportDir, fileName);
            const writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' });
            const cursor = db.collection(collectionName).find({});

            let count = 0;
            for await (const doc of cursor) {
                writeStream.write(`${JSON.stringify(doc)}\n`);
                count += 1;
            }

            await new Promise<void>((resolve, reject) => {
                writeStream.end((streamError?: Error | null) => {
                    if (streamError) {
                        reject(streamError);
                        return;
                    }

                    resolve();
                });
            });

            collectionSummaries.push({
                name: collectionName,
                count,
                file: path.join('collections', fileName)
            });
        }

        backupType = 'ndjson-export';
        backupDetails = {
            exportDir,
            collections: collectionSummaries
        };
    }

    const metadata = {
        createdAt: new Date().toISOString(),
        backupType,
        ...backupDetails
    };
    fs.writeFileSync(path.join(backupDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

    console.log('[backup] completed successfully');
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[backup] failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        process.exit(1);
    });
