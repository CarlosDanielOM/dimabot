import path from 'path';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import UsersSchema, { type IAccounts } from '../schemas/users.schema.js';
import EventsubSchema from '../schemas/eventsub.schema.js';
import { EventSchema } from '../schemas/event.schema.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { getMongoDBConnection } from '../utils/databases/mongodb.database.js';
import {
    CANONICAL_BITS_EVENT_TYPE,
    LEGACY_BITS_EVENT_TYPES,
    migrateLegacyBitsEventsubs
} from '../utils/eventsub.js';

interface RawBitsEventDoc {
    _id: ObjectId;
    type?: unknown;
    name?: unknown;
    config?: unknown;
    enabled?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
}

interface ActiveTwitchUserDoc {
    accounts: IAccounts[];
}

interface EventTemplatePlan {
    keep: RawBitsEventDoc | null;
    updateIds: ObjectId[];
    deleteIds: ObjectId[];
}

interface ChannelMigrationResult {
    channelID: string;
    status: 'migrated' | 'skipped' | 'failed';
    details: string;
}

const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function parseDateMs(value: unknown): number {
    if (value instanceof Date) {
        return value.getTime();
    }

    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
}

function getConfigLength(value: unknown): number {
    return Array.isArray(value) ? value.length : 0;
}

function isCanonicalBitsDoc(doc: RawBitsEventDoc): boolean {
    return doc.type === CANONICAL_BITS_EVENT_TYPE;
}

function choosePreferredBitsEventDoc(current: RawBitsEventDoc | null, candidate: RawBitsEventDoc): RawBitsEventDoc {
    if (!current) {
        return candidate;
    }

    const currentIsCanonical = isCanonicalBitsDoc(current);
    const candidateIsCanonical = isCanonicalBitsDoc(candidate);

    if (candidateIsCanonical !== currentIsCanonical) {
        return candidateIsCanonical ? candidate : current;
    }

    const currentConfigLength = getConfigLength(current.config);
    const candidateConfigLength = getConfigLength(candidate.config);
    if (candidateConfigLength !== currentConfigLength) {
        return candidateConfigLength > currentConfigLength ? candidate : current;
    }

    const currentUpdatedAt = parseDateMs(current.updatedAt) || parseDateMs(current.createdAt);
    const candidateUpdatedAt = parseDateMs(candidate.updatedAt) || parseDateMs(candidate.createdAt);
    if (candidateUpdatedAt !== currentUpdatedAt) {
        return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
    }

    return current;
}

function buildEventTemplatePlan(docs: RawBitsEventDoc[]): EventTemplatePlan {
    const keep = docs.reduce<RawBitsEventDoc | null>((preferred, doc) => choosePreferredBitsEventDoc(preferred, doc), null);

    if (!keep) {
        return {
            keep: null,
            updateIds: [],
            deleteIds: []
        };
    }

    const updateIds: ObjectId[] = [];
    const deleteIds: ObjectId[] = [];

    for (const doc of docs) {
        if (String(doc._id) === String(keep._id)) {
            if (doc.type !== CANONICAL_BITS_EVENT_TYPE) {
                updateIds.push(doc._id);
            }
            continue;
        }

        deleteIds.push(doc._id);
    }

    return {
        keep,
        updateIds,
        deleteIds
    };
}

async function getEligibleActiveTwitchChannelIds(): Promise<string[]> {
    const users = await UsersSchema.find({
        accounts: {
            $elemMatch: {
                type: 'twitch',
                actived: true,
                has_permissions: true,
                up_to_date_permissions: true
            }
        }
    })
        .select('accounts')
        .lean<ActiveTwitchUserDoc[]>();

    const channelIds = new Set<string>();

    for (const user of users) {
        const twitchAccount = user.accounts.find((account) => {
            return account.type === 'twitch'
                && account.actived
                && account.has_permissions
                && account.up_to_date_permissions
                && typeof account.id === 'string'
                && account.id.trim().length > 0;
        });

        if (twitchAccount?.id) {
            channelIds.add(twitchAccount.id);
        }
    }

    return Array.from(channelIds);
}

async function run(): Promise<void> {
    const execute = process.argv.includes('--execute');

    await getMongoDBConnection('migrate_bits_canonical');

    const bitsEventDocs = await EventSchema.collection.find(
        { type: { $in: [CANONICAL_BITS_EVENT_TYPE, ...LEGACY_BITS_EVENT_TYPES] } },
        { projection: { _id: 1, type: 1, name: 1, config: 1, enabled: 1, createdAt: 1, updatedAt: 1 } }
    ).toArray() as RawBitsEventDoc[];

    const eventTemplatePlan = buildEventTemplatePlan(bitsEventDocs);
    const channelsWithLegacyBits = await EventsubSchema.collection.distinct('channelID', {
        type: { $in: [...LEGACY_BITS_EVENT_TYPES] }
    }) as string[];
    const eligibleActiveChannelIds = await getEligibleActiveTwitchChannelIds();
    const channelsNeedingMigration = eligibleActiveChannelIds.filter((channelID) => channelsWithLegacyBits.includes(channelID));

    console.log(`[migration] execute=${execute}`);
    console.log(`[migration] bits event templates found=${bitsEventDocs.length}`);
    console.log(`[migration] bits event template keep=${eventTemplatePlan.keep ? String(eventTemplatePlan.keep._id) : 'none'}`);
    console.log(`[migration] bits event template updates=${eventTemplatePlan.updateIds.length}`);
    console.log(`[migration] bits event template deletes=${eventTemplatePlan.deleteIds.length}`);
    console.log(`[migration] active permission-valid twitch accounts=${eligibleActiveChannelIds.length}`);
    console.log(`[migration] channels with legacy bits subscriptions=${channelsWithLegacyBits.length}`);
    console.log(`[migration] active channels needing migration=${channelsNeedingMigration.length}`);

    if (!execute) {
        console.log('[migration] dry-run complete. Re-run with --execute to apply changes.');
        return;
    }

    if (eventTemplatePlan.keep && eventTemplatePlan.updateIds.length > 0) {
        const now = new Date();
        const eventTemplateResult = await EventSchema.collection.updateMany(
            { _id: { $in: eventTemplatePlan.updateIds } },
            { $set: { type: CANONICAL_BITS_EVENT_TYPE, updatedAt: now } }
        );

        console.log(`[migration] bits event template docs updated=${eventTemplateResult.modifiedCount}`);
    }

    if (eventTemplatePlan.deleteIds.length > 0) {
        const deleteResult = await EventSchema.collection.deleteMany({ _id: { $in: eventTemplatePlan.deleteIds } });
        console.log(`[migration] duplicate bits event template docs deleted=${deleteResult.deletedCount}`);
    }

    const results: ChannelMigrationResult[] = [];

    for (const channelID of channelsNeedingMigration) {
        const token = await TwitchStreamers.getAccountTokenById(channelID, 'twitch');

        if (!token) {
            results.push({
                channelID,
                status: 'skipped',
                details: 'No valid Twitch access token available at runtime'
            });
            console.log(`[migration] skipped channel=${channelID} reason=no_valid_access_token`);
            continue;
        }

        try {
            const migrationResult = await migrateLegacyBitsEventsubs(channelID);
            const status = migrationResult.errors.length > 0 ? 'failed' : 'migrated';
            const details = [
                `createdCanonical=${migrationResult.createdCanonical}`,
                `removedLegacyCount=${migrationResult.removedLegacyCount}`,
                `hadCanonicalBeforeMigration=${migrationResult.hadCanonicalBeforeMigration}`,
                `errors=${migrationResult.errors.length}`
            ].join(' ');

            results.push({ channelID, status, details });
            console.log(`[migration] ${status} channel=${channelID} ${details}`);

            if (migrationResult.errors.length > 0) {
                console.error('[migration] channel migration errors', {
                    channelID,
                    errors: migrationResult.errors
                });
            }
        } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            results.push({ channelID, status: 'failed', details });
            console.error('[migration] channel migration failed', {
                channelID,
                error: details,
                stack: error instanceof Error ? error.stack : undefined
            });
        }
    }

    const migratedCount = results.filter((result) => result.status === 'migrated').length;
    const skippedCount = results.filter((result) => result.status === 'skipped').length;
    const failedCount = results.filter((result) => result.status === 'failed').length;

    console.log(`[migration] channel results migrated=${migratedCount} skipped=${skippedCount} failed=${failedCount}`);
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[migration] failed', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        process.exit(1);
    });
