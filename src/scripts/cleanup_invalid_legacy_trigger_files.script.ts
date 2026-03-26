import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getMongoDBConnection } from '../utils/databases/mongodb.database.js';
import { TriggerFileSchema } from '../schemas/trigger_file.schema.js';
import { TriggerSchema } from '../schemas/trigger.schema.js';

const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const INVALID_LEGACY_PREFIX = 'https://api.domdimabot.com/media/';

type TriggerAction = 'keep' | 'disable' | 'delete';

interface CleanupReport {
    generatedAt: string;
    triggerAction: TriggerAction;
    totals: {
        invalidTriggerFiles: number;
        affectedTriggers: number;
        deletedTriggerFiles?: number;
        disabledTriggers?: number;
        deletedTriggers?: number;
    };
    invalidTriggerFiles: Array<{
        triggerFileID: string;
        channelID: string;
        name: string;
        fileUrl: string;
    }>;
    affectedTriggers: Array<{
        triggerID: string;
        channelID: string;
        name: string;
        fileID?: string | null;
        isEnabled?: boolean;
    }>;
}

function getArgValue(flag: string): string | null {
    const index = process.argv.indexOf(flag);
    if (index === -1) {
        return null;
    }

    return process.argv[index + 1] || null;
}

function getTriggerAction(): TriggerAction {
    const value = getArgValue('--trigger-action');
    if (value === 'disable' || value === 'delete') {
        return value;
    }

    return 'keep';
}

function getReportPath(): string {
    const explicit = getArgValue('--report');
    if (explicit) {
        return path.resolve(process.cwd(), explicit);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.resolve(process.cwd(), '.opencode', 'reports', `cleanup-invalid-trigger-files-${timestamp}.json`);
}

async function run(): Promise<void> {
    const execute = process.argv.includes('--execute');
    const triggerAction = getTriggerAction();
    await getMongoDBConnection('cleanup_invalid_legacy_trigger_files');

    const reportPath = getReportPath();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });

    const invalidTriggerFiles = await TriggerFileSchema.find({
        fileUrl: { $regex: `^${INVALID_LEGACY_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }
    }).lean();

    const invalidIds = invalidTriggerFiles.map((file) => file._id);
    const affectedTriggers = await TriggerSchema.find({
        fileID: { $in: invalidIds }
    }).lean();

    const report: CleanupReport = {
        generatedAt: new Date().toISOString(),
        triggerAction,
        totals: {
            invalidTriggerFiles: invalidTriggerFiles.length,
            affectedTriggers: affectedTriggers.length
        },
        invalidTriggerFiles: invalidTriggerFiles.map((file) => ({
            triggerFileID: String(file._id),
            channelID: file.channelID,
            name: file.name,
            fileUrl: file.fileUrl
        })),
        affectedTriggers: affectedTriggers.map((trigger) => ({
            triggerID: String(trigger._id),
            channelID: trigger.channelID,
            name: trigger.name,
            fileID: trigger.fileID ? String(trigger.fileID) : null,
            isEnabled: trigger.isEnabled
        }))
    };

    if (!execute) {
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log('[cleanup] dry-run complete');
        console.log('[cleanup] report written to:', reportPath);
        console.log('[cleanup] summary:', report.totals);
        console.log('[cleanup] no documents were modified');
        return;
    }

    let disabledTriggers = 0;
    let deletedTriggers = 0;

    if (triggerAction === 'disable' && affectedTriggers.length > 0) {
        const result = await TriggerSchema.updateMany({
            _id: { $in: affectedTriggers.map((trigger) => trigger._id) }
        }, {
            $set: {
                isEnabled: false
            }
        });
        disabledTriggers = result.modifiedCount ?? 0;
    }

    if (triggerAction === 'delete' && affectedTriggers.length > 0) {
        const result = await TriggerSchema.deleteMany({
            _id: { $in: affectedTriggers.map((trigger) => trigger._id) }
        });
        deletedTriggers = result.deletedCount ?? 0;
    }

    const deleteResult = await TriggerFileSchema.deleteMany({
        _id: { $in: invalidIds }
    });

    report.totals.deletedTriggerFiles = deleteResult.deletedCount ?? 0;
    report.totals.disabledTriggers = disabledTriggers;
    report.totals.deletedTriggers = deletedTriggers;

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log('[cleanup] execute complete');
    console.log('[cleanup] report written to:', reportPath);
    console.log('[cleanup] summary:', report.totals);
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[cleanup] failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        process.exit(1);
    });
