import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
import { error as logError } from "../../utils/logger.js";
import { pubSubManager, type ClipRequestData } from '../../classes/pubsub_manager.class.js';

interface RequestClipResponse {
    error: boolean;
    message: string;
    clipID?: string;
}

export interface CheckClipConnectionResponse {
    connected: boolean;
}

export async function checkClipConnection(channelID: string): Promise<CheckClipConnectionResponse> {
    try {
        const cacheClient = await getDragonflyClient('checkClipConnection');
        const connected = await cacheClient.exists(`twitch:${channelID}:clips:connected`);

        return {
            connected: connected === 1
        };
    } catch (err) {
        await logError({ function: 'checkClipConnection',
            channelID,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        }, { channelId: channelID, destination: 'both' });
        return {
            connected: false
        };
    }
}

export function generateRandomClipID(): string {
    const chars = '0123456789ABCDEF';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export async function requestClip(channelID: string, streamerLogin: string, clipData: ClipRequestData, autoProcess: boolean = false): Promise<RequestClipResponse> {
    try {
        const connectionResult = await checkClipConnection(channelID);

        if (!connectionResult.connected) {
            return {
                error: true,
                message: 'OBS not connected - cannot show clips'
            };
        }

        const cacheClient = await getDragonflyClient('requestClip');
        
        // Check if queue is empty or nothing is processing
        const queueLength = await cacheClient.zCard(`twitch:${channelID}:clips:queue`);
        const isProcessing = await cacheClient.exists(`twitch:${channelID}:clip:processing`);
        
        // Auto-process if queue is empty OR nothing is currently processing
        if (!autoProcess && (queueLength === 0 || !isProcessing)) {
            autoProcess = true;
        }

        const clipID = clipData.clipID ? clipData.clipID : generateRandomClipID();
        
        // Ensure clipData has the clipID and timestamp
        const clipDataWithID = {
            ...clipData,
            clipID: clipID,
            timestamp: Date.now()
        };

        await cacheClient.set(`twitch:${channelID}:clips:queue:data:${clipID}`, JSON.stringify(clipDataWithID));
        await cacheClient.zAdd(`twitch:${channelID}:clips:queue`, {
            score: clipDataWithID.timestamp,
            value: clipID
        });
        if (autoProcess) {
            await pubSubManager.publishClipRequest(channelID, clipDataWithID);
        }

        return {
            error: false,
            message: 'Clip queued successfully',
            clipID
        };
    } catch (err) {
        await logError({ function: 'requestClip',
            channelID,
            streamerLogin,
            clipData,
            autoProcess,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        }, { channelId: channelID, destination: 'both' });
        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
