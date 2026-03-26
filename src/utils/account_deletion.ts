import TwitchStreamers from '../classes/twitch_streamers.class.js';
import EventsubSchema from '../schemas/eventsub.schema.js';
import { AdminSchema } from '../schemas/admin.schema.js';
import { ChannelAIMemorySchema } from '../schemas/channel_ai_memory.schema.js';
import { ChannelAIPersonalitySchema } from '../schemas/channel_ai_personality.schema.js';
import { ChannelStreamSummarySchema } from '../schemas/channel_stream_summary.schema.js';
import { ClipDesignSchema } from '../schemas/clip_design.schema.js';
import { CommandTimerSchema } from '../schemas/command_timer.schema.js';
import { CommandUserVariablesSchema } from '../schemas/command_user_variables.schema.js';
import { CommandsSchema } from '../schemas/commands.schema.js';
import { CountdownTimerConfigSchema } from '../schemas/countdown_timer_config.schema.js';
import { CountdownTimerSchema } from '../schemas/countdown_timer.schema.js';
import { RedemptionRewardSchema } from '../schemas/redemption_reward.schema.js';
import { TitleConfigSchema } from '../schemas/title_config.schema.js';
import { TriggerFileSchema } from '../schemas/trigger_file.schema.js';
import { TriggerSchema } from '../schemas/trigger.schema.js';
import UsersSchema from '../schemas/users.schema.js';
import { unsubscribeTwitchEvent } from './eventsub.js';
import { cleanupChannelMediaOwnership } from './media_cleanup.js';
import { decrementSiteAnalytics } from './siteanalytics.js';

export interface IDeleteAccountOptions {
    channelID: string;
    channelName?: string;
    userID: string;
    authorizedAccountsCount: number;
}

export interface IDeleteAccountResult {
    commandsDeleted: number;
    commandVariablesDeleted: number;
    eventsubsDeleted: number;
    rewardsDeleted: number;
    triggersDeleted: number;
    adminsDeleted: number;
    triggerFilesDeleted: number;
    clipDesignsDeleted: number;
    titleConfigsDeleted: number;
    countdownTimersDeleted: number;
    countdownConfigsDeleted: number;
    commandTimersDeleted: number;
    personalitiesDeleted: number;
    memoriesDeleted: number;
    streamSummariesDeleted: number;
    adminAssignmentsDeleted: number;
    usersDeleted: number;
    mediaLibraryItemsRemoved: number;
    privateAssetsDeleted: number;
    publicAssetsTransferred: number;
    mediaAssetCountsUpdated: number;
}

export async function deleteAccountPermanently(options: IDeleteAccountOptions): Promise<IDeleteAccountResult> {
    const { channelID, channelName, userID, authorizedAccountsCount } = options;

    if (!channelID || !userID) {
        throw new Error('channelID and userID are required for account deletion');
    }

    console.log('[ACCOUNT_DELETION] Starting permanent deletion', {
        channelID,
        channelName,
        userID,
        timestamp: new Date().toISOString()
    });

    const existingEventsubs = await EventsubSchema.find({ channelID }).select('id').lean();
    console.log('[ACCOUNT_DELETION] Found eventsubs to unsubscribe', {
        channelID,
        count: existingEventsubs.length
    });

    for (const eventsub of existingEventsubs) {
        if (!eventsub.id) {
            continue;
        }

        try {
            const unsubscribeResult = await unsubscribeTwitchEvent(eventsub.id);
            if (unsubscribeResult?.error) {
                console.error('[ACCOUNT_DELETION] Failed to unsubscribe eventsub', {
                    channelID,
                    eventsubID: eventsub.id,
                    unsubscribeResult,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('[ACCOUNT_DELETION] Error unsubscribing eventsub', {
                channelID,
                eventsubID: eventsub.id,
                error: error instanceof Error ? error.message : String(error),
                timestamp: new Date().toISOString()
            });
        }
    }

    const [commandsDelete, commandVariablesDelete, eventsubsDelete, rewardsDelete, triggersDelete, adminsDelete] = await Promise.all([
        CommandsSchema.deleteMany({ channelID }),
        CommandUserVariablesSchema.deleteMany({ channelID }),
        EventsubSchema.deleteMany({ channelID }),
        RedemptionRewardSchema.deleteMany({ channelID }),
        TriggerSchema.deleteMany({ channelID }),
        AdminSchema.deleteMany({ channelID })
    ]);

    console.log('[ACCOUNT_DELETION] Phase 1 complete - core deletions', {
        channelID,
        commandsDeleted: commandsDelete.deletedCount ?? 0,
        eventsubsDeleted: eventsubsDelete.deletedCount ?? 0
    });

    if ((commandsDelete.deletedCount ?? 0) > 0) {
        await decrementSiteAnalytics('total_commands', commandsDelete.deletedCount ?? 0);
    }

    const [
        mediaCleanup,
        triggerFilesDelete,
        clipDesignsDelete,
        titleConfigsDelete,
        countdownTimersDelete,
        countdownConfigsDelete,
        commandTimersDelete,
        personalitiesDelete,
        memoriesDelete,
        streamSummariesDelete
    ] = await Promise.all([
        cleanupChannelMediaOwnership({ channelID, userID }),
        TriggerFileSchema.deleteMany({ channelID }),
        ClipDesignSchema.deleteMany({ channelID }),
        TitleConfigSchema.deleteMany({ channelID }),
        CountdownTimerSchema.deleteMany({ channelID }),
        CountdownTimerConfigSchema.deleteMany({ channelID }),
        CommandTimerSchema.deleteMany({ channelID }),
        ChannelAIPersonalitySchema.deleteMany({ channelID }),
        ChannelAIMemorySchema.deleteMany({ channelID }),
        ChannelStreamSummarySchema.deleteMany({ channelID })
    ]);

    console.log('[ACCOUNT_DELETION] Phase 2 complete - additional deletions', {
        channelID,
        triggerFilesDeleted: triggerFilesDelete.deletedCount ?? 0,
        personalitiesDeleted: personalitiesDelete.deletedCount ?? 0
    });

    const [adminsAsAdminDelete, userDelete] = await Promise.all([
        AdminSchema.deleteMany({ adminID: channelID }),
        UsersSchema.deleteOne({
            _id: userID,
            'accounts.id': channelID,
            'accounts.type': 'twitch'
        })
    ]);

    console.log('[ACCOUNT_DELETION] Phase 3 complete - user deletion', {
        channelID,
        adminAssignmentsDeleted: adminsAsAdminDelete.deletedCount ?? 0,
        usersDeleted: userDelete.deletedCount ?? 0
    });

    await TwitchStreamers.updateTwitchAccountsInCache();

    if ((userDelete.deletedCount ?? 0) > 0) {
        await decrementSiteAnalytics('registered', 1);
        if (authorizedAccountsCount > 0) {
            await decrementSiteAnalytics('active', authorizedAccountsCount);
        }
    }

    const result: IDeleteAccountResult = {
        commandsDeleted: commandsDelete.deletedCount ?? 0,
        commandVariablesDeleted: commandVariablesDelete.deletedCount ?? 0,
        eventsubsDeleted: eventsubsDelete.deletedCount ?? 0,
        rewardsDeleted: rewardsDelete.deletedCount ?? 0,
        triggersDeleted: triggersDelete.deletedCount ?? 0,
        adminsDeleted: adminsDelete.deletedCount ?? 0,
        triggerFilesDeleted: triggerFilesDelete.deletedCount ?? 0,
        clipDesignsDeleted: clipDesignsDelete.deletedCount ?? 0,
        titleConfigsDeleted: titleConfigsDelete.deletedCount ?? 0,
        countdownTimersDeleted: countdownTimersDelete.deletedCount ?? 0,
        countdownConfigsDeleted: countdownConfigsDelete.deletedCount ?? 0,
        commandTimersDeleted: commandTimersDelete.deletedCount ?? 0,
        personalitiesDeleted: personalitiesDelete.deletedCount ?? 0,
        memoriesDeleted: memoriesDelete.deletedCount ?? 0,
        streamSummariesDeleted: streamSummariesDelete.deletedCount ?? 0,
        adminAssignmentsDeleted: adminsAsAdminDelete.deletedCount ?? 0,
        usersDeleted: userDelete.deletedCount ?? 0,
        mediaLibraryItemsRemoved: mediaCleanup.libraryItemsRemoved,
        privateAssetsDeleted: mediaCleanup.privateAssetsDeleted,
        publicAssetsTransferred: mediaCleanup.publicAssetsTransferred,
        mediaAssetCountsUpdated: mediaCleanup.assetCountsUpdated
    };

    console.log('[ACCOUNT_DELETION] Deletion complete', {
        channelID,
        channelName,
        result,
        timestamp: new Date().toISOString()
    });

    return result;
}
