import TwitchStreamers from "../classes/twitch_streamers.class.js";
import ChatHistory from "../classes/chat_history.js";
import { commandHandler } from "./commands.handler.js";
import { promo } from "../functions/promo/chat.promo.js";
import { router as aiRouter } from "../utils/ai/openrouter/router.ai.js";
import { handleShoutoutCommand } from "../commands/shoutout.command.js";
import { formatBadges } from "../utils/badges.js";
import { error as logError } from "../utils/logger.js";

import { COOLDOWN } from "../classes/cooldown.class.js";
import { storeChatMessageEmbeddingBatched } from "../utils/qdrant/functions/chat_logs/store_chat_log.qdrant.js";

const commandsRegex = new RegExp(/^!([\p{L}\p{N}]+)(?:\W@?)?(.*)?$/u);
const linkRegex = new RegExp(/((http|https):\/\/)?(www\.)?[a-zA-Z-]+(\.[a-zA-Z-]{2})+(:\d+)?(\/\S*)?(\?\S+)?/gi);

//? TODO: Import commands
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import type { IChatMessage } from "../interfaces/twitch/eventsub.interface.js";
import { sendTwitchChatMessage } from "../functions/chats/send_message.chat.js";
import Commands from "../classes/command.class.js";
import { sumimetroCommand } from "../commands/sumimetro.command.js";
import { indexCommands } from "../commands/index.commands.js";
import { sendAnnouncement } from "../functions/chats/announcement.chat.js";
import { clearChat } from "../functions/chats/clear_chat.chat.js";
import { createCommand, deleteCommand, editCommand } from "../commands/command_manager.command.js";

const modID = '698614112';
const CHANNEL_INSTANCES = new Map<string, COOLDOWN>();

let isMod = false;
let tries = 0;

export const messageHandler = async (channelID: string, messageEventData: IChatMessage) => {
    try {
        const STREAMER = await TwitchStreamers.getTwitchAccountById(channelID);
        const cache = await getDragonflyClient('MessageHandler');

        const userLevel = await giveUserLevel(channelID, messageEventData);

        const formattedBadges = await formatBadges({ badges: messageEventData.badges });

        await ChatHistory.addMessage(channelID, messageEventData.chatter_user_name!, messageEventData.message.text, formattedBadges.badgeList);

        storeChatMessageEmbeddingBatched({
            channel_id: channelID,
            channel_name: STREAMER?.name,
            message: messageEventData.message.text,
            username: messageEventData.chatter_user_name!,
            user_id: messageEventData.chatter_user_id || 'unknown',
            timestamp: Math.floor(Date.now() / 1000)
        });

        let on_cooldown = false;
        if(!CHANNEL_INSTANCES.has(channelID)) {
            CHANNEL_INSTANCES.set(channelID, new COOLDOWN());
        }
        const channelInstance = CHANNEL_INSTANCES.get(channelID);
        if(!channelInstance) {
            return;
        }

        if(messageEventData.badges.some(badge => badge.set_id === 'moderator') || messageEventData.chatter_user_id === channelID) isMod = true;

        const [raw, command, argument] = messageEventData.message.text.match(commandsRegex) || [];

        const tags = {
            id: messageEventData.chatter_user_id!,
            username: messageEventData.chatter_user_login!,
            'display-name': messageEventData.chatter_user_name!,
            'user-id': messageEventData.chatter_user_id!,
            mod: isMod
        };

        if(!command) {
            if(messageEventData.message.text.startsWith('@domdimabot') || messageEventData.message.text.startsWith('@DomDimaBot') || messageEventData.message.text.includes('@domdimabot') || messageEventData.message.text.includes('@DomDimaBot')) {
                if(!STREAMER) return;

                if (STREAMER.name == 'ozbellvt' || STREAMER.name == 'littlehuntervt') return;
                
                const recentMessages = await ChatHistory.getRecentMessages(channelID, STREAMER.plan_tier === 'pro' ? 15 : 7);
                const chatHistory = recentMessages.map((msg: any) => ({
                    timestamp: msg.timestamp,
                    badges: msg.badges ? msg.badges.join(' ') : undefined,
                    username: msg.username,
                    message: msg.message
                }));
                
                const aiResponse = await aiRouter(
                    channelID,
                    messageEventData.message.text.replace('@domdimabot', '').replace('@DomDimaBot', ''),
                    '@preset/router',
                    chatHistory,
                    { badges: messageEventData.badges, username: messageEventData.chatter_user_name },
                    [],
                    STREAMER
                );
                
                if (!aiResponse.error && aiResponse.message) {
                    sendTwitchChatMessage(channelID, aiResponse.message);
                }
            }
        }

        let commandFunc = 'none';
        let commandCD = '0';
        let commandEnabled = 'false';
        let commandLevel = '0';
        const streamerArgument = argument ? argument.trim() : '';

        let commandDBData = await Commands.getCommandFromDB(channelID, command);
        if(!commandDBData.error && commandDBData.command) {
            commandFunc = commandDBData.command.func ?? 'none';
            commandCD = String(commandDBData.command.cooldown ?? 0);
            commandEnabled = String(commandDBData.command.enabled ?? false);
            commandLevel = String(commandDBData.command.userLevel ?? 0);
        }

        if(userLevel < parseInt(commandLevel, 10)) {
            return;
        }
        
        
        if(channelInstance!.hasCooldown(command)) {
            on_cooldown = true;
        }

        if(on_cooldown) return;
        
        let res = null;
        
        switch(commandFunc) {
            case 'sumimetro':
                res = await indexCommands.sumimetro(channelID, messageEventData.chatter_user_login!, messageEventData.message.text.split(`!${command}`)[1].trim(), command);
                break;
            case 'promo':
                if (!streamerArgument) {
                    res = { error: true, message: 'Please provide a streamer name to promo. Usage: !promo <streamer>' };
                    break;
                }
                const promoResult = await promo(channelID, streamerArgument, true);
                if (promoResult.error) {
                    res = { error: true, message: promoResult.message || 'Failed to promo streamer' };
                }
                break;
            case 'shoutout':
                if (!streamerArgument) {
                    res = { error: true, message: 'Please provide a user to shoutout. Usage: !so <username>' };
                    break;
                }
                const shoutoutResult = await handleShoutoutCommand(channelID, streamerArgument, 'purple', '698614112', true);
                if (shoutoutResult.error) {
                    res = { error: true, message: shoutoutResult.message || 'Failed to send shoutout' };
                }
                break;
            case 'anuncio':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !anuncio <message>' };
                    break;
                }
                if (streamerArgument.length > 300) {
                    res = { error: true, message: 'Message cannot be longer than 300 characters' };
                    break;
                }
                const anuncioResult = await sendAnnouncement(channelID, messageEventData.chatter_user_id || modID, streamerArgument);
                if (anuncioResult.error) {
                    res = { error: true, message: anuncioResult.message || 'Failed to send announcement' };
                } else {
                    res = { error: false, message: 'Announcement sent' };
                }
                break;
            case 'ruletarusa':
                const ruletarusaBadges = await formatBadges({badges: messageEventData.badges});
                const ruletarusaMod = ruletarusaBadges.isMod;

                const ruletarusaResult = await indexCommands.ruletarusa(channelID, messageEventData.chatter_user_login!, ruletarusaMod);
                if (ruletarusaResult.error) {
                    res = { error: true, message: ruletarusaResult.message || 'Error en ruletarusa' };
                } else {
                    res = { error: false, message: ruletarusaResult.message };
                }
                break;
            case 'amor':
                if (!streamerArgument) {
                    res = { error: true, message: 'Se te olvido poner a la persona a la que quieres medir el amor. No mas por eso te quedaras solter@ toda tu vida.' };
                    break;
                }
                const amorResult = await indexCommands.amor(tags, streamerArgument);
                if (amorResult.error) {
                    res = { error: true, message: amorResult.message || 'Error al medir amor' };
                } else {
                    res = { error: false, message: amorResult.message };
                }
                break;
            case 'disableCommand':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !disable <command name>' };
                    break;
                }
                const disableCommandResult = await indexCommands.disableCommand(channelID, streamerArgument);
                if (disableCommandResult.error) {
                    res = { error: true, message: disableCommandResult.message || 'Error al deshabilitar comando' };
                } else {
                    res = { error: false, message: disableCommandResult.message };
                }
                break;
            case 'enableCommand':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !enable <command name>' };
                    break;
                }
                const enableCommandResult = await indexCommands.enableCommand(channelID, streamerArgument);
                if (enableCommandResult.error) {
                    res = { error: true, message: enableCommandResult.message || 'Error al habilitar comando' };
                } else {
                    res = { error: false, message: enableCommandResult.message };
                }
                break;
            case 'createCommand':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !cc <command name> <command function>' };
                    break;
                }
                const createCommandResult = await createCommand(channelID, streamerArgument);
                if (createCommandResult.error) {
                    res = { error: true, message: createCommandResult.message || 'Error creating command' };
                } else {
                    res = { error: false, message: createCommandResult.message || 'Command created' };
                }
                break;
            case 'deleteCommand':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !dc <command name>' };
                    break;
                }
                const deleteCommandResult = await deleteCommand(channelID, streamerArgument, userLevel);
                if (deleteCommandResult.error) {
                    res = { error: true, message: deleteCommandResult.message || 'Error deleting command' };
                } else {
                    res = { error: false, message: deleteCommandResult.message || 'Command deleted' };
                }
                break;
            case 'editCommand':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !ec <command name> <command function>' };
                    break;
                }
                const editCommandResult = await editCommand(channelID, streamerArgument, userLevel);
                if (editCommandResult.error) {
                    res = { error: true, message: editCommandResult.message || 'Error updating command' };
                } else {
                    res = { error: false, message: editCommandResult.message || 'Command updated' };
                }
                break;
            case 'clearChat':
                const clearChatResult = await clearChat(channelID, messageEventData.chatter_user_id || modID);
                if (clearChatResult.error) {
                    res = { error: true, message: clearChatResult.message || 'Failed to clear chat' };
                } else {
                    res = { error: false, message: `Chat cleared by ${messageEventData.chatter_user_name}` };
                }
                break;
            case 'commands':
                const commandListResult = await indexCommands.commandList(channelID, userLevel);
                if (commandListResult.error) {
                    res = { error: true, message: commandListResult.message || 'Error al listar comandos' };
                } else {
                    res = { error: false, message: commandListResult.message };
                }
                break;
            case 'followage':
                const followageResult = await indexCommands.followage(channelID, streamerArgument || messageEventData.chatter_user_login!);
                if (followageResult.error) {
                    res = { error: true, message: followageResult.message || 'Error al obtener followage' };
                } else {
                    res = { error: false, message: followageResult.message };
                }
                break;
            case 'title':
                const titleResult = await indexCommands.title(channelID, streamerArgument, userLevel, parseInt(commandLevel, 10));
                if (titleResult.error) {
                    res = { error: true, message: titleResult.message || 'Error al obtener titulo' };
                } else {
                    res = { error: false, message: titleResult.message };
                }
                break;
            case 'game':
                const gameResult = await indexCommands.game(channelID, streamerArgument, userLevel, parseInt(commandLevel, 10));
                if (gameResult.error) {
                    res = { error: true, message: gameResult.message || 'Error al obtener juego' };
                } else {
                    res = { error: false, message: gameResult.message };
                }
                break;
            case 'mod':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !mod @username' };
                    break;
                }
                const addModeratorResult = await indexCommands.addModerator(channelID, streamerArgument);
                if (addModeratorResult.error) {
                    res = { error: true, message: addModeratorResult.message || 'Error al agregar moderador' };
                } else {
                    res = { error: false, message: addModeratorResult.message };
                }
                break;
            case 'unmod':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !unmod @username' };
                    break;
                }
                const removeModeratorResult = await indexCommands.removeModerator(channelID, streamerArgument);
                if (removeModeratorResult.error) {
                    res = { error: true, message: removeModeratorResult.message || 'Error al remover moderador' };
                } else {
                    res = { error: false, message: removeModeratorResult.message };
                }
                break;
            case 'createClip':
                const createClipResult = await indexCommands.createClip(channelID);
                if (createClipResult.error) {
                    res = { error: true, message: createClipResult.message || 'Error al crear clip' };
                } else {
                    res = { error: false, message: createClipResult.message };
                }
                break;
            case 'onlyemotes':
                const onlyEmotesResult = await indexCommands.onlyEmotes(channelID, streamerArgument);
                if (onlyEmotesResult.error) {
                    res = { error: true, message: onlyEmotesResult.message || 'Error al cambiar modo only emotes' };
                } else {
                    res = { error: false, message: onlyEmotesResult.message };
                }
                break;
            case 'speach':
                const speechResult = await indexCommands.speech(channelID, tags, streamerArgument);
                if (speechResult.error) {
                    res = { error: true, message: speechResult.message || 'Error al enviar speech' };
                } else {
                    res = { error: false, message: speechResult.message };
                }
                break;
            case 'vanish':
                const vanishResult = await indexCommands.vanish(channelID, tags, modID);
                if (vanishResult.error) {
                    res = { error: true, message: vanishResult.message || 'Error al hacer vanish' };
                } else {
                    res = { error: false, message: vanishResult.message };
                }
                break;
            case 'duel':
                const duelResult = await indexCommands.duel(channelID, messageEventData.chatter_user_login!, isMod, streamerArgument, modID);
                if (duelResult.error) {
                    res = { error: true, message: duelResult.message || 'Error en duelo' };
                } else {
                    res = { error: false, message: duelResult.message };
                }
                break;
            case 'miyuloot':
                const miyulootResult = await indexCommands.miyuloot(channelID, tags);
                if (miyulootResult.error) {
                    res = { error: true, message: miyulootResult.message || 'Error en miyuloot' };
                } else {
                    res = { error: false, message: miyulootResult.message };
                }
                break;
            case 'vip':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !vip @username [duration]' };
                    break;
                }
                const addVipResult = await indexCommands.addVip(channelID, streamerArgument, tags);
                if (addVipResult.error) {
                    res = { error: true, message: addVipResult.message || 'Error al agregar VIP' };
                } else {
                    res = { error: false, message: addVipResult.message };
                }
                break;
            case 'unvip':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !unvip @username' };
                    break;
                }
                const removeVipResult = await indexCommands.removeVip(channelID, streamerArgument);
                if (removeVipResult.error) {
                    res = { error: true, message: removeVipResult.message || 'Error al remover VIP' };
                } else {
                    res = { error: false, message: removeVipResult.message };
                }
                break;
            case 'poll':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !poll Title;Choice1/Choice2;duration' };
                    break;
                }
                const pollResult = await indexCommands.poll('CREATE', channelID, streamerArgument);
                if (pollResult.error) {
                    res = { error: true, message: pollResult.message || 'Error al crear poll' };
                } else {
                    res = { error: false, message: pollResult.message };
                }
                break;
            case 'endpoll':
                const endPollResult = await indexCommands.poll('END', channelID, '');
                if (endPollResult.error) {
                    res = { error: true, message: endPollResult.message || 'Error al terminar poll' };
                } else {
                    res = { error: false, message: endPollResult.message };
                }
                break;
            case 'archivepoll':
                const archivePollResult = await indexCommands.poll('ARCHIVE', channelID, '');
                if (archivePollResult.error) {
                    res = { error: true, message: archivePollResult.message || 'Error al archivar poll' };
                } else {
                    res = { error: false, message: archivePollResult.message };
                }
                break;
            case 'cancelpoll':
                const terminatePollResult = await indexCommands.poll('TERMINATE', channelID, '');
                if (terminatePollResult.error) {
                    res = { error: true, message: terminatePollResult.message || 'Error al terminar poll' };
                } else {
                    res = { error: false, message: terminatePollResult.message };
                }
                break;
            case 'predi':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !predi Title;Outcome1/Outcome2;duration' };
                    break;
                }
                const predictionResult = await indexCommands.prediction('CREATE', channelID, streamerArgument);
                if (predictionResult.error) {
                    res = { error: true, message: predictionResult.message || 'Error al crear prediction' };
                } else {
                    res = { error: false, message: predictionResult.message };
                }
                break;
            case 'endpredi':
                if (!streamerArgument) {
                    res = { error: true, message: 'Usage: !endpredi <option number>' };
                    break;
                }
                const resolvePredictionResult = await indexCommands.prediction('RESOLVED', channelID, streamerArgument);
                if (resolvePredictionResult.error) {
                    res = { error: true, message: resolvePredictionResult.message || 'Error al resolver prediction' };
                } else {
                    res = { error: false, message: resolvePredictionResult.message };
                }
                break;
            case 'cancelpredi':
                const cancelPredictionResult = await indexCommands.prediction('CANCELLED', channelID, '');
                if (cancelPredictionResult.error) {
                    res = { error: true, message: cancelPredictionResult.message || 'Error al cancelar prediction' };
                } else {
                    res = { error: false, message: cancelPredictionResult.message };
                }
                break;
            case 'lockpredi':
                const lockPredictionResult = await indexCommands.prediction('LOCKED', channelID, '');
                if (lockPredictionResult.error) {
                    res = { error: true, message: lockPredictionResult.message || 'Error al bloquear prediction' };
                } else {
                    res = { error: false, message: lockPredictionResult.message };
                }
                break;
            default:
                const cmdResult = await commandHandler(channelID, messageEventData, command, argument);
                if (!cmdResult.error && cmdResult.message) {
                    res = { error: false, message: cmdResult.message };
                }
                break;
            }

        if(commandCD !== '0') {
            channelInstance!.setCooldown(command, parseInt(commandCD! ?? '0', 10));
        }

        // if(commandEnabled !== 'true') {
        //     tries++; 
        //     if(tries % 50 == 0) {
        //         sendTwitchChatMessage(channelID, 'Ando en mantenimiento, un bug cibernetico se comio mis circuitos');
        //     }
        //     return;
        // };

        if(res && res.error) {
            // logger({error: true, message: res.message, response: res, username: messageEventData.chatter_user_name, channel: messageEventData.channel_name}, true, channelID, `command-${channelID}-${command}-${messageEventData.chatter_user_name}`);
        }

        if(!res || !res.message) return;

        sendTwitchChatMessage(channelID, res.message)
    } catch (err) {
        await logError({
            function: 'messageHandler',
            error: err instanceof Error ? err.message : String(err)
        }, { channelId: channelID, destination: 'both' });
    }
}

async function giveUserLevel(channelID: string, messageEventData: IChatMessage) {
    let userLevel = 1;
    let cache = await getDragonflyClient('UserLevel');

    if(messageEventData.badges.some(badge => badge.set_id === 'subscriber')) {
        userLevel = 2;
    }

    if(messageEventData.badges.some(badge => badge.set_id === 'vip')) {
        userLevel = 5;
    }

    if(messageEventData.badges.some(badge => badge.set_id === 'founder')) {
        userLevel = 6;
    }

    if(messageEventData.badges.some(badge => badge.set_id === 'moderator')) {
        userLevel = 7;
    }

    const isEditor = await cache.sIsMember(`${channelID}:channel:editors`, messageEventData.chatter_user_login!);
    if(isEditor) {
        userLevel = 8;
    }

    const isAdmin = await cache.sIsMember(`${channelID}:admins`, messageEventData.chatter_user_login!);
    if(isAdmin) {
        userLevel = 9;
    }

    return userLevel;
}