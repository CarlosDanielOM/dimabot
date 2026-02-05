import { getTwitchUserByLogin } from '../functions/users/index.js';
import { getChannelInformation } from '../functions/channels/index.js';
import { showClip } from '../functions/clips/index.js';
import { getChannelClips } from '../functions/clips/index.js';
import { sendAnnouncement, sendTwitchChatMessage } from '../functions/chats/index.js';
import { sendShoutout } from '../functions/chats/index.js';

interface RaiderChannel {
    name: string;
    login: string;
    game: string;
}

interface ShoutoutResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    raiderChannel?: RaiderChannel;
}

const shoutoutCooldowns = new Map<string, number>();

export async function handleShoutoutCommand(
    channelID: string,
    targetUser: string,
    color: string = 'purple',
    modID: string = '698614112',
    showClipEnabled: boolean = true,
    customMessage?: string
): Promise<ShoutoutResponse> {
    try {
        const targetUserTrimmed = targetUser.trim();

        if (!channelID || !targetUserTrimmed) {
            return {
                error: true,
                message: 'Missing parameters',
                status: 400,
                type: 'error'
            };
        }

        const streamerDataResult = await getTwitchUserByLogin(targetUserTrimmed, true);

        if (streamerDataResult.error || !streamerDataResult.data) {
            console.error(`Error in handleShoutoutCommand: Failed to get user data`, {
                channelID,
                targetUser: targetUserTrimmed,
                streamerDataResult
            });

            return {
                error: true,
                message: streamerDataResult.message || 'Failed to get user data',
                status: streamerDataResult.status,
                type: 'error'
            };
        }

        const targetUserData = streamerDataResult.data;

        if (!targetUserData.id) {
            return {
                error: true,
                message: 'User not found',
                status: 404,
                type: 'error'
            };
        }

        const targetChannelDataResult = await getChannelInformation(targetUserData.id, true);

        if (targetChannelDataResult.error || !targetChannelDataResult.data) {
            console.error(`Error in handleShoutoutCommand: Failed to get channel information`, {
                channelID,
                targetUserID: targetUserData.id,
                targetChannelDataResult
            });

            return {
                error: true,
                message: targetChannelDataResult.message || 'Failed to get channel information',
                status: targetChannelDataResult.status,
                type: 'error'
            };
        }

        const targetChannelData = targetChannelDataResult.data;

        const raiderChannel: RaiderChannel = {
            name: targetChannelData.broadcaster_name,
            login: targetChannelData.broadcaster_login,
            game: targetChannelData.game_name
        };

        const message = customMessage || `Check out ${raiderChannel.name} at https://twitch.tv/${raiderChannel.login} and give them a follow! They were last playing ${raiderChannel.game}`;

        const announcementResult = await sendAnnouncement(
            channelID,
            modID,
            message,
            color
        );

        if (announcementResult.error) {
            console.error(`Error in handleShoutoutCommand: Failed to send announcement`, {
                channelID,
                message,
                announcementResult
            });

            sendTwitchChatMessage(channelID, message);
        }

        const cooldownKey = `${channelID}:${targetUserData.id}`;
        const lastShoutout = shoutoutCooldowns.get(cooldownKey);
        const now = Date.now();

        if (lastShoutout && now - lastShoutout < 120000) {
            console.log(`Shoutout skipped - on cooldown`, {
                channelID,
                targetUserID: targetUserData.id,
                cooldownRemaining: Math.ceil((120000 - (now - lastShoutout)) / 1000)
            });
        } else {
            shoutoutCooldowns.set(cooldownKey, now);

            const shoutoutResult = await sendShoutout(
                channelID,
                targetUserData.id,
                modID
            );

            if (shoutoutResult.error) {
                console.error(`Error in handleShoutoutCommand: Failed to send shoutout`, {
                    channelID,
                    targetUserID: targetUserData.id,
                    shoutoutResult
                });
            }
        }

        if (showClipEnabled) {
            try {
                const clipsResult = await getChannelClips(targetUserData.id, null, true);

                if (!clipsResult.error && clipsResult.data && clipsResult.data.length > 0) {
                    const clipResult = await showClip(
                        channelID,
                        clipsResult.data,
                        targetUserData,
                        targetChannelData,
                        false
                    );

                    if (clipResult.error) {
                        console.error(`Error in handleShoutoutCommand: Failed to show clip`, {
                            channelID,
                            targetUserID: targetUserData.id,
                            clipResult
                        });
                    }
                }
            } catch (error) {
                console.error(`Error in handleShoutoutCommand: Clip processing error`, {
                    channelID,
                    targetUserID: targetUserData.id,
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                });
            }
        }

        return {
            error: false,
            message: '',
            raiderChannel
        };
    } catch (error) {
        console.error(`Error in handleShoutoutCommand:`, {
            channelID,
            targetUser,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return {
            error: true,
            message: 'Internal server error',
            type: 'error'
        };
    }
}
