import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getMongoDBConnection } from '../utils/databases/mongodb.database.js';
import { TriggerSchema } from '../schemas/trigger.schema.js';
import { RedemptionRewardSchema } from '../schemas/redemption_reward.schema.js';

const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SAFE_TRIGGER_NAME_REGEX = /^[A-Za-z0-9_]+$/;

interface MigrationReportEntry {
    triggerId: string;
    channelID: string;
    oldTriggerName: string;
    newTriggerName: string;
    rewardID: string;
    rewardTitle: string;
    oldRewardType: string;
    oldRewardMessage: string;
    newRewardMessage: string;
    renamedTrigger: boolean;
    updatedRewardMessage: boolean;
    normalizedTriggerType: boolean;
}

interface MigrationReport {
    generatedAt: string;
    totals: {
        linkedTriggers: number;
        migratable: number;
        renamedTriggers: number;
        updatedRewardMessages: number;
        normalizedTriggerTypes: number;
        missingRewardDocs: number;
        invalidNamesFound: number;
        rewardlessMessagesFound: number;
    };
    missingRewardDocs: Array<{
        triggerId: string;
        channelID: string;
        triggerName: string;
        rewardID: string;
    }>;
    entries: MigrationReportEntry[];
}

function getArgValue(flag: string): string | null {
    const index = process.argv.indexOf(flag);
    if (index === -1) {
        return null;
    }

    return process.argv[index + 1] || null;
}

function getReportPath(): string {
    const explicit = getArgValue('--report');
    if (explicit) {
        return path.resolve(process.cwd(), explicit);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.resolve(process.cwd(), '.opencode', 'reports', `legacy-trigger-reward-migration-${timestamp}.json`);
}

function sanitizeTriggerName(name: string): string {
    const sanitized = name
        .replace(/[^A-Za-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    return sanitized || 'trigger';
}

function buildTriggerCommand(triggerName: string, queueFlag?: boolean): string {
    return `$(trigger.send ${triggerName}${queueFlag ? ' true' : ''})`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceTriggerSendCommand(message: string, nextName: string): string {
    const pattern = /\$\(\s*trigger\.send\s+([^\s)]+)(?:\s+(true|false))?\s*\)/g;
    if (!pattern.test(message)) {
        return message;
    }

    return message.replace(pattern, (_match, _oldName, queueFlag) => buildTriggerCommand(nextName, queueFlag === 'true'));
}

function buildMigratedRewardMessage(existingMessage: string, nextName: string): string {
    const trimmed = (existingMessage || '').trim();
    if (!trimmed) {
        return buildTriggerCommand(nextName);
    }

    if (/\$\(\s*trigger\.send\s+/.test(trimmed)) {
        return replaceTriggerSendCommand(trimmed, nextName);
    }

    return `${buildTriggerCommand(nextName)} ${trimmed}`;
}

async function buildUniqueNamesByChannel(): Promise<Map<string, Set<string>>> {
    const triggers = await TriggerSchema.find({}).select('channelID name').lean();
    const usedNames = new Map<string, Set<string>>();
    for (const trigger of triggers) {
        if (!usedNames.has(trigger.channelID)) {
            usedNames.set(trigger.channelID, new Set());
        }
        usedNames.get(trigger.channelID)!.add(trigger.name);
    }
    return usedNames;
}

function ensureUniqueName(channelID: string, currentName: string, desiredName: string, usedNames: Map<string, Set<string>>): string {
    if (!usedNames.has(channelID)) {
        usedNames.set(channelID, new Set());
    }

    const names = usedNames.get(channelID)!;
    names.delete(currentName);

    let candidate = desiredName;
    let suffix = 2;
    while (names.has(candidate)) {
        candidate = `${desiredName}_${suffix}`;
        suffix += 1;
    }

    names.add(candidate);
    return candidate;
}

async function run(): Promise<void> {
    const execute = process.argv.includes('--execute');
    await getMongoDBConnection('migrate_legacy_trigger_rewards');

    const reportPath = getReportPath();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });

    const linkedTriggers = await TriggerSchema.find({ rewardID: { $exists: true, $ne: '' } }).lean();
    const rewards = await RedemptionRewardSchema.find({ rewardID: { $in: linkedTriggers.map((trigger) => trigger.rewardID) } }).lean();
    const rewardMap = new Map(rewards.map((reward) => [`${reward.channelID}:${reward.rewardID}`, reward]));
    const usedNames = await buildUniqueNamesByChannel();

    const missingRewardDocs: MigrationReport['missingRewardDocs'] = [];
    const entries: MigrationReportEntry[] = [];
    let renamedTriggers = 0;
    let updatedRewardMessages = 0;
    let normalizedTriggerTypes = 0;
    let invalidNamesFound = 0;
    let rewardlessMessagesFound = 0;

    for (const trigger of linkedTriggers) {
        const reward = rewardMap.get(`${trigger.channelID}:${trigger.rewardID}`);
        if (!reward) {
            missingRewardDocs.push({
                triggerId: String(trigger._id),
                channelID: trigger.channelID,
                triggerName: trigger.name,
                rewardID: trigger.rewardID
            });
            continue;
        }

        const desiredName = SAFE_TRIGGER_NAME_REGEX.test(trigger.name) ? trigger.name : sanitizeTriggerName(trigger.name);
        const nextName = ensureUniqueName(trigger.channelID, trigger.name, desiredName, usedNames);
        const oldRewardMessage = reward.message || '';
        const newRewardMessage = buildMigratedRewardMessage(oldRewardMessage, nextName);
        const renamedTrigger = nextName !== trigger.name;
        const updatedRewardMessage = newRewardMessage !== oldRewardMessage;
        const normalizedTriggerType = trigger.type !== 'trigger';

        if (!SAFE_TRIGGER_NAME_REGEX.test(trigger.name)) {
            invalidNamesFound += 1;
        }
        if (!oldRewardMessage.trim()) {
            rewardlessMessagesFound += 1;
        }
        if (renamedTrigger) {
            renamedTriggers += 1;
        }
        if (updatedRewardMessage) {
            updatedRewardMessages += 1;
        }
        if (normalizedTriggerType) {
            normalizedTriggerTypes += 1;
        }

        entries.push({
            triggerId: String(trigger._id),
            channelID: trigger.channelID,
            oldTriggerName: trigger.name,
            newTriggerName: nextName,
            rewardID: trigger.rewardID,
            rewardTitle: reward.title,
            oldRewardType: reward.type,
            oldRewardMessage,
            newRewardMessage,
            renamedTrigger,
            updatedRewardMessage,
            normalizedTriggerType
        });
    }

    const report: MigrationReport = {
        generatedAt: new Date().toISOString(),
        totals: {
            linkedTriggers: linkedTriggers.length,
            migratable: entries.length,
            renamedTriggers,
            updatedRewardMessages,
            normalizedTriggerTypes,
            missingRewardDocs: missingRewardDocs.length,
            invalidNamesFound,
            rewardlessMessagesFound
        },
        missingRewardDocs,
        entries
    };

    if (!execute) {
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log('[legacy-trigger-migration] dry-run complete');
        console.log('[legacy-trigger-migration] report written to:', reportPath);
        console.log('[legacy-trigger-migration] summary:', report.totals);
        return;
    }

    for (const entry of entries) {
        const triggerUpdate: Record<string, any> = {};
        if (entry.renamedTrigger) {
            triggerUpdate.name = entry.newTriggerName;
        }
        if (entry.normalizedTriggerType) {
            triggerUpdate.type = 'trigger';
        }

        if (Object.keys(triggerUpdate).length > 0) {
            await TriggerSchema.updateOne({ _id: entry.triggerId }, { $set: triggerUpdate });
        }

        if (entry.updatedRewardMessage) {
            await RedemptionRewardSchema.updateOne(
                { channelID: entry.channelID, rewardID: entry.rewardID },
                { $set: { message: entry.newRewardMessage } }
            );
        }
    }

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log('[legacy-trigger-migration] execute complete');
    console.log('[legacy-trigger-migration] report written to:', reportPath);
    console.log('[legacy-trigger-migration] summary:', report.totals);
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[legacy-trigger-migration] failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        process.exit(1);
    });
