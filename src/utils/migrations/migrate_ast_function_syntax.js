import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const ROOT_DIR = process.cwd();
const AST_FUNCTIONS_DIR = path.join(ROOT_DIR, 'src', 'utils', 'ast_parser', 'functions');
const AST_FUNCTIONS_INDEX = path.join(AST_FUNCTIONS_DIR, 'index.ts');

dotenv.config({ path: path.resolve(ROOT_DIR, '.env.local') });
dotenv.config({ path: path.resolve(ROOT_DIR, '.env') });

function parseArgs(argv) {
    const apply = argv.includes('--apply');
    const dryRun = !apply;
    return { apply, dryRun };
}

async function getAllowedAstFunctions() {
    const indexContent = await fs.readFile(AST_FUNCTIONS_INDEX, 'utf8');
    const importedFiles = new Set();

    const importRegex = /from\s+['"]\.\/([^'"]+)\.js['"]/g;
    let importMatch;
    while ((importMatch = importRegex.exec(indexContent)) !== null) {
        const fileName = importMatch[1];
        if (fileName === 'index') continue;
        importedFiles.add(`${fileName}.ts`);
    }

    const entries = await fs.readdir(AST_FUNCTIONS_DIR, { withFileTypes: true });
    const names = new Set();

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
        if (!importedFiles.has(entry.name)) continue;
        const filePath = path.join(AST_FUNCTIONS_DIR, entry.name);
        const content = await fs.readFile(filePath, 'utf8');
        const regex = /registerFunction\(\s*['"]([^'"]+)['"]/g;

        let match;
        while ((match = regex.exec(content)) !== null) {
            names.add(match[1]);
        }
    }

    return [...names];
}

function collectLegacyLikeHeads(text) {
    if (typeof text !== 'string' || text.length === 0) return [];

    const heads = [];
    const regex = /\$\(\s*([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        heads.push(`${match[1].toLowerCase()}.${match[2].toLowerCase()}`);
    }
    return heads;
}

function buildLegacyToDottedMap(functionNames) {
    const dotted = functionNames.filter((name) => name.includes('.'));
    const map = new Map();

    for (const name of dotted) {
        const legacy = name.replace(/\./g, ' ');
        map.set(legacy, name);
    }

    return map;
}

function migrateFunctionHead(content, aliases) {
    const leadingWhitespace = (content.match(/^\s*/) || [''])[0];
    const rest = content.slice(leadingWhitespace.length);

    const identifierMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
    if (!identifierMatch) {
        return content;
    }

    const firstIdentifier = identifierMatch[1];
    const afterFirstIndex = firstIdentifier.length;
    const nextChar = rest[afterFirstIndex] || '';

    if (nextChar === '.') {
        return content;
    }

    if (nextChar !== '' && !/\s/.test(nextChar)) {
        return content;
    }

    for (const { legacyRegex, dotted } of aliases) {
        const match = rest.match(legacyRegex);
        if (!match) continue;

        const matchedText = match[0];
        const remainder = rest.slice(matchedText.length);
        return `${leadingWhitespace}${dotted}${remainder}`;
    }

    return content;
}

function migrateSyntaxText(text, aliases) {
    let output = '';
    let i = 0;

    while (i < text.length) {
        if (text[i] === '$' && text[i + 1] === '(') {
            const parsed = parseAndMigrateFunctionCall(text, i, aliases);
            output += parsed.segment;
            i = parsed.nextIndex;
            continue;
        }

        output += text[i];
        i += 1;
    }

    return output;
}

function parseAndMigrateFunctionCall(text, startIndex, aliases) {
    let i = startIndex + 2;
    let depth = 1;
    let inString = false;
    let escaped = false;

    while (i < text.length) {
        const char = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            i += 1;
            continue;
        }

        if (char === '"') {
            inString = true;
            i += 1;
            continue;
        }

        if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth -= 1;
            if (depth === 0) {
                const innerContent = text.slice(startIndex + 2, i);
                const migratedInnerCalls = migrateSyntaxText(innerContent, aliases);
                const migratedHead = migrateFunctionHead(migratedInnerCalls, aliases);
                return {
                    segment: `$(${migratedHead})`,
                    nextIndex: i + 1
                };
            }
        }

        i += 1;
    }

    return {
        segment: text.slice(startIndex),
        nextIndex: text.length
    };
}

function buildSortedAliases(legacyToDotted) {
    const aliases = [...legacyToDotted.entries()].map(([legacy, dotted]) => {
        const escapedLegacy = legacy
            .split(' ')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('\\s+');

        return {
            legacy,
            dotted,
            wordCount: legacy.split(' ').length,
            legacyRegex: new RegExp(`^${escapedLegacy}(?=$|\\s)`, 'i')
        };
    });

    aliases.sort((a, b) => b.wordCount - a.wordCount);
    return aliases;
}

async function migrateCommandsMessages({ apply, dryRun }, aliases) {
    const collection = mongoose.connection.db.collection('commands');
    const query = { message: { $type: 'string', $regex: /\$\(/ } };
    const cursor = collection.find(query, { projection: { _id: 1, message: 1, cmd: 1, channelID: 1 } });

    let scanned = 0;
    let changed = 0;
    let unresolvedLegacyHeads = 0;
    const bulkUpdates = [];

    while (await cursor.hasNext()) {
        const doc = await cursor.next();
        if (!doc) continue;

        scanned += 1;
        const oldMessage = String(doc.message || '');
        const newMessage = migrateSyntaxText(oldMessage, aliases);

        unresolvedLegacyHeads += collectLegacyLikeHeads(newMessage).length;

        if (newMessage === oldMessage) continue;

        changed += 1;
        bulkUpdates.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { message: newMessage } }
            }
        });
    }

    let modified = 0;
    if (apply && bulkUpdates.length > 0) {
        const result = await collection.bulkWrite(bulkUpdates, { ordered: false });
        modified = result.modifiedCount || 0;
    }

    return {
        collection: 'commands',
        field: 'message',
        scanned,
        changed,
        unresolvedLegacyHeads,
        modified,
        dryRun
    };
}

async function migrateEventsubsMessages({ apply, dryRun }, aliases) {
    const collection = mongoose.connection.db.collection('eventsubs');
    const query = {
        $or: [
            { message: { $type: 'string', $regex: /\$\(/ } },
            { endMessage: { $type: 'string', $regex: /\$\(/ } },
            { temporalBanMessage: { $type: 'string', $regex: /\$\(/ } },
            { 'cheerTiers.message': { $regex: /\$\(/ } }
        ]
    };
    const cursor = collection.find(query, {
        projection: {
            _id: 1,
            type: 1,
            channelID: 1,
            message: 1,
            endMessage: 1,
            temporalBanMessage: 1,
            cheerTiers: 1
        }
    });

    let scanned = 0;
    let changed = 0;
    let unresolvedLegacyHeads = 0;
    const bulkUpdates = [];

    while (await cursor.hasNext()) {
        const doc = await cursor.next();
        if (!doc) continue;

        scanned += 1;
        const updates = {};

        if (typeof doc.message === 'string') {
            const migrated = migrateSyntaxText(doc.message, aliases);
            if (migrated !== doc.message) {
                updates.message = migrated;
            }
            unresolvedLegacyHeads += collectLegacyLikeHeads(migrated).length;
        }

        if (typeof doc.endMessage === 'string') {
            const migrated = migrateSyntaxText(doc.endMessage, aliases);
            if (migrated !== doc.endMessage) {
                updates.endMessage = migrated;
            }
            unresolvedLegacyHeads += collectLegacyLikeHeads(migrated).length;
        }

        if (typeof doc.temporalBanMessage === 'string') {
            const migrated = migrateSyntaxText(doc.temporalBanMessage, aliases);
            if (migrated !== doc.temporalBanMessage) {
                updates.temporalBanMessage = migrated;
            }
            unresolvedLegacyHeads += collectLegacyLikeHeads(migrated).length;
        }

        if (Array.isArray(doc.cheerTiers)) {
            let tiersChanged = false;
            const migratedTiers = doc.cheerTiers.map((tier) => {
                if (!tier || typeof tier !== 'object' || typeof tier.message !== 'string') {
                    return tier;
                }

                const migratedMessage = migrateSyntaxText(tier.message, aliases);
                if (migratedMessage === tier.message) {
                    unresolvedLegacyHeads += collectLegacyLikeHeads(migratedMessage).length;
                    return tier;
                }

                tiersChanged = true;
                unresolvedLegacyHeads += collectLegacyLikeHeads(migratedMessage).length;
                return {
                    ...tier,
                    message: migratedMessage
                };
            });

            if (tiersChanged) {
                updates.cheerTiers = migratedTiers;
            }
        }

        if (Object.keys(updates).length === 0) continue;

        changed += 1;
        bulkUpdates.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: updates }
            }
        });
    }

    let modified = 0;
    if (apply && bulkUpdates.length > 0) {
        const result = await collection.bulkWrite(bulkUpdates, { ordered: false });
        modified = result.modifiedCount || 0;
    }

    return {
        collection: 'eventsubs',
        field: 'message/endMessage/temporalBanMessage/cheerTiers.message',
        scanned,
        changed,
        unresolvedLegacyHeads,
        modified,
        dryRun
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is not set. Please configure .env.local or .env');
    }

    const functionNames = await getAllowedAstFunctions();
    const legacyToDotted = buildLegacyToDottedMap(functionNames);
    const aliases = buildSortedAliases(legacyToDotted);

    console.log('AST function syntax migration');
    console.log(`Mode: ${options.apply ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);
    console.log(`Detected AST functions: ${functionNames.length}`);
    console.log(`Detected spaced aliases to migrate: ${aliases.length}`);

    await mongoose.connect(process.env.MONGO_URI);

    try {
        const reports = [
            await migrateCommandsMessages(options, aliases),
            await migrateEventsubsMessages(options, aliases)
        ];

        console.log('');
        console.log('Migration report');
        for (const report of reports) {
            console.log(`- Collection: ${report.collection}`);
            console.log(`  Field: ${report.field}`);
            console.log(`  Scanned docs: ${report.scanned}`);
            console.log(`  Changed docs: ${report.changed}`);
            console.log(`  Modified docs: ${report.modified}`);
            console.log(`  Remaining legacy-like heads: ${report.unresolvedLegacyHeads}`);
            console.log(`  Dry run: ${report.dryRun}`);
        }
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((error) => {
    console.error('Migration failed:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
    });

    process.exitCode = 1;
});
