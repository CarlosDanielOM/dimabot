import type { FilterQuery } from 'mongoose';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import type { ITwitchEventData } from '../interfaces/twitch/eventsub.interface.js';
import { AstVariablesSchema, type IAstVariables } from '../schemas/ast_variables.schema.js';
import type { IEventsub } from '../schemas/eventsub.schema.js';
import { createExecutionContext, renderAstWithSourceReference } from '../utils/ast_parser/index.js';
import { registerAllFunctions } from '../utils/ast_parser/functions/index.js';
import type { ExecutionContext } from '../utils/ast_parser/types.js';

export interface ISpecialParserContext {
    channelID: string;
    scopeType?: string;
    scopeName?: string;
    scopeAliases?: string[];
    eventData?: ITwitchEventData | Record<string, unknown>;
    eventsubData?: IEventsub | Record<string, unknown>;
    argument?: string;
    count?: number;
    variables?: Record<string, string>;
    userPlan?: 'free' | 'premium' | 'pro';
    userLevel?: number;
    extraContext?: Record<string, unknown>;
}

export interface ISpecialParserResult {
    parsedText: string;
    count: number;
}

interface IExtractedUserInfo {
    userName?: string;
    userLogin?: string;
    userID?: string;
}

interface IExtractedBroadcasterInfo {
    broadcasterName?: string;
    broadcasterLogin?: string;
    broadcasterID?: string;
}

interface IExtractedNumericInfo {
    bits?: number;
    viewers?: number;
}

interface IBadgeLike {
    set_id?: string;
    id?: string;
}

interface IPlaceholderResolution {
    text: string;
    error?: string;
}

const MODERATOR_BADGE_IDS = new Set([
    'moderator',
    'lead_mod',
    'lead_moderator',
    'mod'
]);

function inferUserLevelFromBadges(eventData: Record<string, unknown>): number {
    const badges = Array.isArray(eventData.badges) ? (eventData.badges as IBadgeLike[]) : [];

    for (const badge of badges) {
        const badgeSetId = String(badge?.set_id || badge?.id || '').toLowerCase();
        if (MODERATOR_BADGE_IDS.has(badgeSetId)) {
            return 7;
        }
    }

    return 1;
}

function extractUserInfo(eventData: Record<string, unknown>): IExtractedUserInfo {
    return {
        userName: String(
            eventData.chatter_user_name
            || eventData.user_name
            || eventData.from_broadcaster_user_name
            || eventData.moderator_user_name
            || ''
        ) || undefined,
        userLogin: String(
            eventData.chatter_user_login
            || eventData.user_login
            || eventData.from_broadcaster_user_login
            || eventData.moderator_user_login
            || ''
        ) || undefined,
        userID: String(
            eventData.chatter_user_id
            || eventData.user_id
            || eventData.from_broadcaster_user_id
            || eventData.moderator_user_id
            || ''
        ) || undefined
    };
}

function extractBroadcasterInfo(eventData: Record<string, unknown>): IExtractedBroadcasterInfo {
    return {
        broadcasterName: String(eventData.broadcaster_user_name || eventData.to_broadcaster_user_name || '') || undefined,
        broadcasterLogin: String(eventData.broadcaster_user_login || eventData.to_broadcaster_user_login || '') || undefined,
        broadcasterID: String(eventData.broadcaster_user_id || eventData.to_broadcaster_user_id || '') || undefined
    };
}

function extractNumericFields(eventData: Record<string, unknown>): IExtractedNumericInfo {
    const cheer = eventData.cheer as Record<string, unknown> | undefined;
    const bits = eventData.bits || cheer?.bits;
    const viewers = eventData.viewers;

    return {
        bits: bits !== undefined ? Number(bits) : undefined,
        viewers: viewers !== undefined ? Number(viewers) : undefined
    };
}

function unescapeInput(input: unknown): string {
    if (typeof input !== 'string') return String(input || '');
    return input
        .replace(/\\\$/g, '$')
        .replace(/\\%/g, '%')
        .replace(/\\\*/g, '*');
}

function resolveArgumentPlaceholders(template: string, argument: string): IPlaceholderResolution {
    const input = String(template || '');

    if (!input.includes('&p') && !input.includes('&t')) {
        return { text: input };
    }

    const argumentText = String(argument || '').trim();
    const argTokens = argumentText.length > 0 ? argumentText.split(/\s+/).filter(Boolean) : [];
    const createdPositions = new Set<number>();
    let maxCreatedPosition = 0;
    let textModeStarted = false;
    let textTail = '';
    let hasInvalidOrder = false;

    const text = input.replace(/&p(\d+)|&t\b/g, (match, pIndexRaw: string) => {
        if (match === '&t') {
            if (!textModeStarted) {
                textModeStarted = true;
                textTail = argTokens.slice(maxCreatedPosition).join(' ');
            }
            return textTail;
        }

        const position = Number.parseInt(String(pIndexRaw || ''), 10);
        if (!Number.isFinite(position) || position < 1) {
            return '';
        }

        const alreadyCreated = createdPositions.has(position);
        if (textModeStarted && !alreadyCreated) {
            hasInvalidOrder = true;
            return '';
        }

        if (!alreadyCreated) {
            createdPositions.add(position);
            if (position > maxCreatedPosition) {
                maxCreatedPosition = position;
            }
        }

        return argTokens[position - 1] ?? '';
    });

    if (hasInvalidOrder) {
        return {
            text,
            error: 'cannot create new &pN after &t'
        };
    }

    return { text };
}

function normalizeScopeName(scopeName: string): string {
    const normalized = String(scopeName || '').trim().replace(/\s+/g, '_');
    return normalized || 'default';
}

function normalizeScopeNames(scopeNames: string[]): string[] {
    if (!scopeNames || scopeNames.length === 0) {
        return [];
    }

    const normalized = scopeNames
        .map((name) => normalizeScopeName(name))
        .filter((name) => name !== 'default');

    return [...new Set(normalized)];
}

function normalizeUserLogin(userLogin: string): string {
    return String(userLogin || '').trim().replace(/^@+/, '').toLowerCase();
}

async function loadScopedVariable(
    channelID: string,
    scopeType: string,
    scopeName: string,
    variableName: string,
    userId: string = '',
    userLogin: string = ''
): Promise<string> {
    try {
        const query: FilterQuery<IAstVariables> = {
            channelID,
            scopeType,
            scopeName
        };

        const normalizedLogin = normalizeUserLogin(userLogin);
        if (normalizedLogin) {
            query.userLogin = normalizedLogin;
        } else {
            query.userId = userId;
        }

        const doc = await AstVariablesSchema.findOne(query).select({ variables: 1 }).exec();
        const mapData = doc?.variables;
        if (!mapData) {
            return '';
        }

        const value = mapData.get(variableName);
        return value ?? '';
    } catch (error) {
        console.error('Error loading AST scoped variable:', {
            channelID,
            scopeType,
            scopeName,
            userId,
            userLogin,
            variableName,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
        return '';
    }
}

async function saveScopedVariable(
    channelID: string,
    scopeType: string,
    scopeName: string,
    variableName: string,
    value: string,
    userId: string = '',
    userLogin: string = ''
): Promise<void> {
    const normalizedLogin = normalizeUserLogin(userLogin);
    const baseQuery: FilterQuery<IAstVariables> = {
        channelID,
        scopeType,
        scopeName,
        ...(userId ? { userId } : { userLogin: normalizedLogin })
    };

    const update = {
        $set: {
            [`variables.${variableName}`]: value,
            userLogin: normalizedLogin
        },
        $setOnInsert: {
            channelID,
            scopeType,
            scopeName,
            userId,
            userLogin: normalizedLogin
        }
    };

    try {
        await AstVariablesSchema.findOneAndUpdate(baseQuery, update, { upsert: true }).exec();
    } catch (error) {
        const mongoCode = typeof error === 'object' && error !== null && 'code' in error
            ? Number((error as { code?: unknown }).code)
            : undefined;

        if (mongoCode === 11000 && userId && normalizedLogin) {
            try {
                await AstVariablesSchema.findOneAndUpdate(
                    { channelID, scopeType, scopeName, userLogin: normalizedLogin },
                    {
                        $set: {
                            [`variables.${variableName}`]: value,
                            userId,
                            userLogin: normalizedLogin
                        },
                        $setOnInsert: {
                            channelID,
                            scopeType,
                            scopeName,
                            userId,
                            userLogin: normalizedLogin
                        }
                    },
                    { upsert: true }
                ).exec();
                return;
            } catch (fallbackError) {
                console.error('Error saving AST scoped variable (fallback):', {
                    channelID,
                    scopeType,
                    scopeName,
                    userId,
                    userLogin,
                    variableName,
                    error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
                    stack: fallbackError instanceof Error ? fallbackError.stack : undefined,
                    timestamp: new Date().toISOString()
                });
                return;
            }
        }

        console.error('Error saving AST scoped variable:', {
            channelID,
            scopeType,
            scopeName,
            userId,
            userLogin,
            variableName,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}

export async function parseSpecialCommands(
    text: string,
    context: ISpecialParserContext
): Promise<ISpecialParserResult> {
    const placeholderResolution = resolveArgumentPlaceholders(text, context.argument || '');
    if (placeholderResolution.error) {
        return {
            parsedText: `[Parser error: ${placeholderResolution.error}]`,
            count: context.count || 0
        };
    }

    registerAllFunctions();
    const streamer = await TwitchStreamers.getTwitchAccountById(context.channelID);

    const eventData = (context.eventData || {}) as Record<string, unknown>;
    const eventsubData = (context.eventsubData || {}) as Record<string, unknown>;

    const extracted = {
        ...extractUserInfo(eventData),
        ...extractBroadcasterInfo(eventData),
        ...extractNumericFields(eventData)
    };

    const mergedExtraContext = {
        ...extracted,
        ...context.extraContext
    };

    const variables = new Map<string, unknown>();
    if (context.variables) {
        for (const [key, value] of Object.entries(context.variables)) {
            variables.set(key, value);
        }
    }

    const inferredUserLevel = inferUserLevelFromBadges(eventData);
    const effectiveUserLevel = Math.max(context.userLevel ?? 1, inferredUserLevel);

    const resolvedScopeType = context.scopeType || 'command';
    const resolvedScopeName = normalizeScopeName(
        context.scopeName
        || String(eventsubData.name || '')
        || String((eventData.reward as Record<string, unknown> | undefined)?.title || '')
        || ''
    );
    const resolvedScopeAliases = normalizeScopeNames(context.scopeAliases || [])
        .filter((name) => name !== resolvedScopeName);

    const astContext: ExecutionContext = createExecutionContext({
        broadcasterId: context.channelID,
        userId: extracted.userID || '',
        userLogin: extracted.userLogin || '',
        userDisplayName: extracted.userName || '',
        userPlan: context.userPlan || (streamer?.plan_tier as 'free' | 'premium' | 'pro' | undefined) || 'free',
        userLevel: effectiveUserLevel,
        argument: context.argument,
        count: context.count || 0,
        eventData,
        eventsubData,
        extraContext: mergedExtraContext,
        streamer: streamer ? { id: streamer.id, name: streamer.name } : null,
        scopeType: resolvedScopeType,
        scopeName: resolvedScopeName,
        scopeAliases: resolvedScopeAliases,
        commandName: resolvedScopeName,
        variables,
        saveChannelVariable: async (name: string, value: string) => {
            await saveScopedVariable(context.channelID, resolvedScopeType, resolvedScopeName, name, value, '');
        },
        loadChannelVariable: async (name: string) => {
            const value = await loadScopedVariable(context.channelID, resolvedScopeType, resolvedScopeName, name, '');
            if (value !== '') {
                return value;
            }

            for (const alias of resolvedScopeAliases) {
                const aliasValue = await loadScopedVariable(context.channelID, resolvedScopeType, alias, name, '');
                if (aliasValue !== '') {
                    return aliasValue;
                }
            }

            return '';
        },
        saveUserVariable: async (name: string, value: string) => {
            const userId = extracted.userID || '';
            const userLogin = extracted.userLogin || '';
            if (!userId) {
                return;
            }
            await saveScopedVariable(context.channelID, resolvedScopeType, resolvedScopeName, name, value, userId, userLogin);
        },
        loadUserVariable: async (name: string, targetUserLogin?: string) => {
            const userId = extracted.userID || '';
            const userLogin = extracted.userLogin || '';
            const normalizedTargetLogin = normalizeUserLogin(targetUserLogin || '');

            if (!userId && !normalizedTargetLogin) {
                console.error('AST user-scoped variable read skipped: missing userId', {
                    channelID: context.channelID,
                    scopeType: resolvedScopeType,
                    scopeName: resolvedScopeName,
                    variableName: name,
                    timestamp: new Date().toISOString()
                });
                return '';
            }

            const preferredUserId = normalizedTargetLogin ? '' : userId;
            const preferredUserLogin = normalizedTargetLogin || userLogin;
            const value = await loadScopedVariable(
                context.channelID,
                resolvedScopeType,
                resolvedScopeName,
                name,
                preferredUserId,
                preferredUserLogin
            );

            if (value !== '') {
                return value;
            }

            for (const alias of resolvedScopeAliases) {
                const aliasValue = await loadScopedVariable(
                    context.channelID,
                    resolvedScopeType,
                    alias,
                    name,
                    preferredUserId,
                    preferredUserLogin
                );
                if (aliasValue !== '') {
                    return aliasValue;
                }
            }

            return '';
        }
    });

    const { parsedText: renderedText, context: resultContext } = await renderAstWithSourceReference(
        placeholderResolution.text,
        astContext
    );

    const parsedText = unescapeInput(String(renderedText || ''));

    return {
        parsedText,
        count: resultContext.count
    };
}

export { parseSpecialCommands as specialCommands };
