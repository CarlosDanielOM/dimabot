import { getDragonflyClient } from '../../utils/databases/dragonfly.database.js';
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
    } catch (error) {
        console.error(`Error in checkClipConnection:`, {
            channelID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

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
        const clipID = generateRandomClipID();

        const timestamp = Date.now();

        await cacheClient.set(`twitch:${channelID}:clips:queue:data:${clipID}`, JSON.stringify(clipData));
        await cacheClient.zAdd(`twitch:${channelID}:clips:queue`, {
            score: timestamp,
            value: clipID
        });

        if (autoProcess) {
            await pubSubManager.publishClipRequest(channelID, clipData);
        }

        return {
            error: false,
            message: 'Clip queued successfully',
            clipID
        };
    } catch (error) {
        console.error(`Error in requestClip:`, {
            channelID,
            streamerLogin,
            clipData,
            autoProcess,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
