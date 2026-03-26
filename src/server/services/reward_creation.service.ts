import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { RedemptionRewardSchema, type IRedemptionReward } from '../../schemas/redemption_reward.schema.js';
import { getTwitchStreamerHeaderById } from '../../utils/header.js';
import { getTwitchHelixUrl } from '../../utils/links.js';
import { subscribeTwitchEvent, unsubscribeTwitchEvent } from '../../utils/eventsub.js';
import { error as logError, info as logInfo } from '../../utils/logger.js';

interface CreateRewardServiceInput {
    channelID: string;
    body: Record<string, any>;
    correlationId?: string;
}

interface CreateRewardServiceResponse {
    error: boolean;
    message: string;
    status: number;
    data?: IRedemptionReward;
}

function twitchBodyParser(body: Record<string, any>): Record<string, any> {
    const parsed = { ...body };

    if ('isEnabled' in parsed) {
        parsed.is_enabled = parsed.isEnabled;
        delete parsed.isEnabled;
    }

    if (parsed.skipQueue) {
        parsed.should_redemptions_skip_request_queue = true;
        delete parsed.skipQueue;
    }

    if (parsed.cooldown && parsed.cooldown > 0) {
        parsed.is_global_cooldown_enabled = true;
        parsed.global_cooldown_seconds = parsed.cooldown;
        delete parsed.cooldown;
    } else if (parsed.cooldown === 0) {
        parsed.is_global_cooldown_enabled = false;
        parsed.global_cooldown_seconds = 0;
        delete parsed.cooldown;
    }

    if (parsed.userInput !== undefined) {
        parsed.is_user_input_required = parsed.userInput;
        delete parsed.userInput;
    }

    return parsed;
}

async function deleteTwitchReward(channelID: string, rewardID: string): Promise<void> {
    const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);
    if (streamerHeaderResult.error || !streamerHeaderResult.header) {
        throw new Error(streamerHeaderResult.message || 'Failed to get streamer header');
    }

    const params = new URLSearchParams();
    params.append('broadcaster_id', channelID);
    params.append('id', rewardID);

    const response = await fetch(
        getTwitchHelixUrl('channel_points/custom_rewards', params.toString()),
        {
            method: 'DELETE',
            headers: streamerHeaderResult.header as unknown as Record<string, string>
        }
    );

    if (response.status !== 204) {
        const result = await response.json();
        throw new Error(result?.message || result?.error || 'Failed to delete Twitch reward');
    }
}

export async function patchTwitchReward(channelID: string, body: Record<string, any>, rewardID: string): Promise<any> {
    const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

    if (streamerHeaderResult.error || !streamerHeaderResult.header) {
        return { error: streamerHeaderResult.message };
    }

    const parsedBody = twitchBodyParser(body);
    const params = new URLSearchParams();
    params.append('broadcaster_id', channelID);
    params.append('id', rewardID);

    const response = await fetch(
        getTwitchHelixUrl('channel_points/custom_rewards', params.toString()),
        {
            method: 'PATCH',
            headers: streamerHeaderResult.header as unknown as Record<string, string>,
            body: JSON.stringify(parsedBody)
        }
    );

    const result = await response.json();

    if (result.error) {
        return result;
    }

    return result.data?.[0];
}

async function createTwitchReward(channelID: string, body: Record<string, any>): Promise<any> {
    const streamerHeaderResult = await getTwitchStreamerHeaderById(channelID);

    if (streamerHeaderResult.error || !streamerHeaderResult.header) {
        return { error: streamerHeaderResult.message };
    }

    const parsedBody = twitchBodyParser(body);
    const params = new URLSearchParams();
    params.append('broadcaster_id', channelID);

    const response = await fetch(
        getTwitchHelixUrl('channel_points/custom_rewards', params.toString()),
        {
            method: 'POST',
            headers: streamerHeaderResult.header as unknown as Record<string, string>,
            body: JSON.stringify(parsedBody)
        }
    );

    const result = await response.json();

    if (result.error) {
        return result;
    }

    return result.data?.[0];
}

export async function cleanupRewardArtifacts(
    channelID: string,
    rewardID: string,
    eventsubID?: string,
    correlationId?: string
): Promise<void> {
    try {
        await Promise.allSettled([
            deleteTwitchReward(channelID, rewardID),
            eventsubID ? unsubscribeTwitchEvent(eventsubID) : Promise.resolve(null),
            RedemptionRewardSchema.deleteOne({ channelID, rewardID })
        ]);

        await logInfo({
            message: 'Reward artifacts cleanup completed',
            channelID,
            rewardID,
            eventsubID,
            correlationId
        }, { channelId: channelID, destination: 'cache' });
    } catch (err) {
        await logError({
            function: 'cleanupRewardArtifacts',
            channelID,
            rewardID,
            eventsubID,
            correlationId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: channelID, destination: 'both' });
    }
}

export async function createRewardWithEventsub({
    channelID,
    body,
    correlationId
}: CreateRewardServiceInput): Promise<CreateRewardServiceResponse> {
    const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
    if (!streamer) {
        return {
            error: true,
            message: 'Streamer not found',
            status: 404
        };
    }

    const rewardData = await createTwitchReward(channelID, body);

    if (rewardData?.error || !rewardData?.id) {
        await logError({
            function: 'createRewardWithEventsub.createTwitchReward',
            channelID,
            correlationId,
            response: rewardData
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: rewardData?.message || rewardData?.error || 'Failed to create Twitch reward',
            status: 400
        };
    }

    const eventsubData = await subscribeTwitchEvent(
        channelID,
        'channel.channel_points_custom_reward_redemption.add',
        '1',
        { broadcaster_user_id: channelID, reward_id: rewardData.id } as any
    );

    if ((eventsubData as any)?.error || !(eventsubData as any)?.id) {
        await cleanupRewardArtifacts(channelID, rewardData.id, undefined, correlationId);

        await logError({
            function: 'createRewardWithEventsub.subscribeTwitchEvent',
            channelID,
            rewardID: rewardData.id,
            correlationId,
            response: eventsubData
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: (eventsubData as any)?.message || (eventsubData as any)?.error || 'Failed to create eventsub',
            status: 400
        };
    }

    const rawCostChange = body.costChange ?? body.priceIncrease ?? 0;
    const costChange = Number.isFinite(Number(rawCostChange)) ? Number(rawCostChange) : 0;
    const rewardMessage = body.message || '';
    const returnToOriginalCost = body.returnToOriginalCost || false;

    const rewardPayload = {
        eventsubID: (eventsubData as any).id,
        channelID,
        channel: streamer.name,
        rewardID: rewardData.id,
        title: rewardData.title,
        prompt: rewardData.prompt,
        cost: rewardData.cost,
        originalCost: rewardData.cost,
        isEnabled: rewardData.is_enabled,
        costChange,
        message: rewardMessage,
        returnToOriginalCost,
        cooldown: body.cooldown || 0,
        createdFrom: body.createdFrom || 'domdimabot',
        createdFor: body.createdFor || 'twitch',
        type: body.type || 'custom',
        duration: body.duration || 0
    };

    let newReward: IRedemptionReward | null = null;

    try {
        newReward = await RedemptionRewardSchema.findOneAndUpdate(
            { channelID, rewardID: rewardData.id },
            rewardPayload,
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            }
        );
    } catch (err) {
        await cleanupRewardArtifacts(channelID, rewardData.id, (eventsubData as any).id, correlationId);

        await logError({
            function: 'createRewardWithEventsub.saveRedemptionReward',
            channelID,
            rewardID: rewardData.id,
            eventsubID: (eventsubData as any).id,
            correlationId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Error saving new reward',
            status: 500
        };
    }

    if (!newReward || !newReward.rewardID || !newReward.eventsubID) {
        await cleanupRewardArtifacts(channelID, rewardData.id, (eventsubData as any).id, correlationId);

        await logError({
            function: 'createRewardWithEventsub.postSaveValidation',
            channelID,
            rewardID: newReward?.rewardID,
            eventsubID: newReward?.eventsubID,
            correlationId,
            error: 'Saved reward is missing rewardID or eventsubID'
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Invalid reward state after save',
            status: 500
        };
    }

    const persistedReward = await RedemptionRewardSchema.findOne({ channelID, rewardID: rewardData.id });

    if (!persistedReward) {
        await logError({
            function: 'createRewardWithEventsub.postPersistValidation',
            channelID,
            rewardID: rewardData.id,
            eventsubID: (eventsubData as any).id,
            correlationId,
            error: 'Reward document missing after upsert'
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Reward persistence validation failed',
            status: 500
        };
    }

    await logInfo({
        message: 'Reward and eventsub created successfully',
        channelID,
        rewardID: persistedReward.rewardID,
        eventsubID: persistedReward.eventsubID,
        correlationId
    }, { channelId: channelID, destination: 'cache' });

    return {
        error: false,
        message: 'Reward created successfully',
        status: 201,
        data: persistedReward
    };
}
