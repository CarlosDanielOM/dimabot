import { ban } from '../functions/moderation/index.js';
import { getChannelModerators } from '../functions/moderation/index.js';
import { getTwitchUserByLogin } from '../functions/users/index.js';
import { removeChannelModerator } from '../functions/channels/remove_moderator.channel.js';
import { addModerator } from '../functions/channels/add_moderator.channel.js';
import { sendTwitchChatMessage } from '../functions/chats/index.js';
import TwitchStreamers from '../classes/twitch_streamers.class.js';
import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';

interface DuelResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

const battlePhrases = [
    "The battle is intense, who will win?",
    "Looks like someone is having the advantages!",
    "The tension is rising in the arena!",
    "A flurry of blows! Both duelists are holding their ground.",
    "The crowd is going wild!",
    "Is that a secret technique I see?",
    "One mistake could end it all now...",
    "The ground trembles under their feet!",
    "Neither side is backing down!",
    "An epic clash of titans!",
    "Dust fills the air as they trade hits!",
    "Who will emerge victorious from this struggle?"
];

export async function duelCommand(channelID: string, user: string, userMod: boolean, argument: string, modID: string = '698614112'): Promise<DuelResponse> {
    try {
        if (!user || !argument) {
            return {
                error: true,
                message: 'You must provide a user to duel.'
            };
        }

        if (argument.toLowerCase() === user.toLowerCase()) {
            return {
                error: true,
                message: 'You cannot duel yourself.'
            };
        }

        const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
        if (!streamer) {
            return {
                error: true,
                message: 'Streamer not found'
            };
        }

        if (argument === streamer.name || user.toLowerCase() === streamer.name) {
            return {
                error: true,
                message: 'You cannot duel the channel owner.'
            };
        }

        const cacheClient = await getDragonflyClient('duelCommand');
        const editor = await cacheClient.sIsMember(`${channelID}:channel:editors`, user.toLowerCase());

        if (editor === 1) {
            return {
                error: true,
                message: 'As an Editor, you cannot duel.'
            };
        }

        const editorOpponent = await cacheClient.sIsMember(`${channelID}:channel:editors`, argument.toLowerCase());
        if (editorOpponent === 1) {
            return {
                error: true,
                message: 'You cannot duel an Editor.'
            };
        }

        if (argument === 'accept') {
            const exists = await cacheClient.exists(`${channelID}:duel:${user.toLowerCase()}`);
            if (exists) {
                const duelist = await cacheClient.get(`${channelID}:duel:${user.toLowerCase()}`);
                await cacheClient.del(`${channelID}:duel:${user.toLowerCase()}`);

                if (!duelist) {
                    return {
                        error: true,
                        message: 'No duelist found'
                    };
                }

                const phrasesCount = Math.floor(Math.random() * 3) + 2;
                const selectedPhrases = [...battlePhrases].sort(() => 0.5 - Math.random()).slice(0, phrasesCount);

                for (const phrase of selectedPhrases) {
                    const waitTime = Math.floor(Math.random() * 2001) + 1000;
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    sendTwitchChatMessage(channelID, phrase);
                }

                await new Promise(resolve => setTimeout(resolve, 1500));

                const probability = Math.floor(Math.random() * 121);
                const winner = probability % 2;

                if (winner === 0) {
                    const userData = await getTwitchUserByLogin(duelist);
                    if (userData.error || !userData.data) {
                        return {
                            error: true,
                            message: userData.message
                        };
                    }

                    const moderator = await getChannelModerators(channelID, [userData.data.id]);
                    if (moderator.error) {
                        return {
                            error: true,
                            message: moderator.message
                        };
                    }

                    if (moderator.data && moderator.data.length > 0) {
                        const moderatorId = moderator.ids?.[0];
                        if (moderatorId) {
                            await removeChannelModerator(channelID, moderatorId);
                            setTimeout(async () => {
                                const add = await addModerator(channelID, moderatorId);
                                if (add.error) {
                                    console.error({ add });
                                }
                            }, 70000);
                        }
                    }

                    const timeout = await ban(channelID, userData.data.id, modID, 60, 'Duel');

                    if (timeout.error) {
                        return {
                            error: true,
                            message: timeout.message
                        };
                    }

                    return {
                        error: false,
                        message: `@${user} has won the duel against @${duelist}.`
                    };
                } else {
                    const userData = await getTwitchUserByLogin(user);
                    if (userData.error || !userData.data) {
                        return {
                            error: true,
                            message: userData.message
                        };
                    }

                    const moderator = await getChannelModerators(channelID, [userData.data.id]);
                    if (moderator.error) {
                        return {
                            error: true,
                            message: moderator.message
                        };
                    }

                    if (moderator.data && moderator.data.length > 0) {
                        const moderatorId = moderator.ids?.[0];
                        if (moderatorId) {
                            const add = await removeChannelModerator(channelID, moderatorId);
                            if (add.error) {
                                console.error({ add });
                            }

                            setTimeout(async () => {
                                await addModerator(channelID, moderatorId);
                            }, 70000);
                        }
                    }

                    const timeout = await ban(channelID, userData.data.id, modID, 60, 'Duel');

                    if (timeout.error) {
                        return {
                            error: true,
                            message: timeout.message
                        };
                    }

                    return {
                        error: false,
                        message: `@${duelist} has won the duel against @${user}.`
                    };
                }
            } else {
                return {
                    error: true,
                    message: 'There is no duel challenge to accept.'
                };
            }
        } else if (argument === 'decline') {
            await cacheClient.del(`${channelID}:duel:${user.toLowerCase()}`);
            return {
                error: false,
                message: `@${user} has declined the duel challenge from @${argument}.`
            };
        } else {
            await cacheClient.set(`${channelID}:duel:${argument.toLowerCase()}`, user.toLowerCase());
            await cacheClient.expire(`${channelID}:duel:${argument.toLowerCase()}`, 180);

            return {
                error: false,
                message: `@${user} has challenged @${argument} to a duel! Type \"!duel accept\" to accept the challenge or \"!duel decline\" to decline the challenge.`
            };
        }
    } catch (error) {
        console.error(`Error in duelCommand:`, {
            channelID,
            user,
            argument,
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
