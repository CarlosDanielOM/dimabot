import path from 'path';
import dotenv from 'dotenv';
import { ObjectId } from 'mongodb';
import { getMongoDBConnection } from '../utils/databases/mongodb.database.js';
import { EventSchema } from '../schemas/event.schema.js';

type PlanTier = 'free' | 'premium' | 'pro';

interface LegacyTierLimits {
  free?: unknown;
  basic?: unknown;
  premium?: unknown;
  pro?: unknown;
  premium_plus?: unknown;
}

interface RawEventDoc {
  _id: ObjectId;
  plan_tier?: unknown;
  premium?: unknown;
  premium_plus?: unknown;
  tierLimits?: LegacyTierLimits;
}

const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
}
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function toBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolvePlanTier(doc: RawEventDoc): PlanTier {
  if (doc.plan_tier === 'free' || doc.plan_tier === 'premium' || doc.plan_tier === 'pro') {
    return doc.plan_tier;
  }

  if (toBoolean(doc.premium_plus)) {
    return 'pro';
  }

  if (toBoolean(doc.premium)) {
    return 'premium';
  }

  return 'free';
}

function resolveTierLimits(doc: RawEventDoc): Record<'free' | 'premium' | 'pro', number> {
  const tierLimits = doc.tierLimits ?? {};

  const free = toNumber(tierLimits.free ?? tierLimits.basic, 0);
  const premium = toNumber(tierLimits.premium, 2);
  const pro = toNumber(tierLimits.pro ?? tierLimits.premium_plus, 5);

  return { free, premium, pro };
}

async function run(): Promise<void> {
  const execute = process.argv.includes('--execute');

  await getMongoDBConnection('migrate_event_plan_tier');

  const docs = await EventSchema.collection
    .find({}, { projection: { _id: 1, plan_tier: 1, premium: 1, premium_plus: 1, tierLimits: 1 } })
    .toArray() as RawEventDoc[];

  const operations: Array<{ updateOne: { filter: { _id: ObjectId }; update: Record<string, unknown> } }> = [];

  for (const doc of docs) {
    const nextPlanTier = resolvePlanTier(doc);
    const nextTierLimits = resolveTierLimits(doc);

    const setOps: Record<string, unknown> = {};
    const unsetOps: Record<string, ''> = {};

    if (doc.plan_tier !== nextPlanTier) {
      setOps.plan_tier = nextPlanTier;
    }

    const currentFree = toNumber(doc.tierLimits?.free, Number.NaN);
    const currentPremium = toNumber(doc.tierLimits?.premium, Number.NaN);
    const currentPro = toNumber(doc.tierLimits?.pro, Number.NaN);

    if (currentFree !== nextTierLimits.free) {
      setOps['tierLimits.free'] = nextTierLimits.free;
    }

    if (currentPremium !== nextTierLimits.premium) {
      setOps['tierLimits.premium'] = nextTierLimits.premium;
    }

    if (currentPro !== nextTierLimits.pro) {
      setOps['tierLimits.pro'] = nextTierLimits.pro;
    }

    if (doc.premium !== undefined) {
      unsetOps.premium = '';
    }

    if (doc.premium_plus !== undefined) {
      unsetOps.premium_plus = '';
    }

    if (doc.tierLimits?.basic !== undefined) {
      unsetOps['tierLimits.basic'] = '';
    }

    if (doc.tierLimits?.premium_plus !== undefined) {
      unsetOps['tierLimits.premium_plus'] = '';
    }

    if (Object.keys(setOps).length === 0 && Object.keys(unsetOps).length === 0) {
      continue;
    }

    const update: Record<string, unknown> = {};
    if (Object.keys(setOps).length > 0) {
      update.$set = setOps;
    }
    if (Object.keys(unsetOps).length > 0) {
      update.$unset = unsetOps;
    }

    operations.push({
      updateOne: {
        filter: { _id: doc._id },
        update,
      },
    });
  }

  console.log(`[migration] matched documents: ${docs.length}`);
  console.log(`[migration] documents requiring update: ${operations.length}`);

  if (!execute) {
    console.log('[migration] dry-run complete. Re-run with --execute to apply changes.');
    return;
  }

  if (operations.length === 0) {
    console.log('[migration] no changes to apply.');
    return;
  }

  const result = await EventSchema.collection.bulkWrite(operations, { ordered: false });
  console.log(`[migration] applied. modifiedCount=${result.modifiedCount}`);
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
