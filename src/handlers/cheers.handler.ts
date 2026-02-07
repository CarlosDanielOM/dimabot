import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";
import { sendTwitchChatMessage } from "../functions/chats/index.js";
import { parseSpecialCommands } from "./special_parser.handler.js";
import type { IBitUseEvent, ITwitchEventData } from "../interfaces/twitch/eventsub.interface.js";
import type { IEventsub } from "../schemas/eventsub.schema.js";
import { error as logError } from "../utils/logger.js";

export const cheersHandler = async (channelID: string, eventData: ITwitchEventData, eventsubData: IEventsub, chatEnabled: boolean = true) => {
    try {
        if (!chatEnabled) return;

        const cache = await getDragonflyClient('Eventsub');

        if((eventData as IBitUseEvent).is_anonymous) {
            sendTwitchChatMessage(channelID, `Gracias por los ${(eventData as IBitUseEvent).bits} bits Anonimo!`);
            return;
        }

        const parsedMessage = await parseSpecialCommands(eventsubData.message, {
            channelID,
            eventData,
            argument: '',
            count: 0
        });

        if(parsedMessage.parsedText == '' || parsedMessage.parsedText == null) return;

        sendTwitchChatMessage(channelID, parsedMessage.parsedText);

    } catch (err) {
        await logError({
            function: 'cheersHandler',
            error: err instanceof Error ? err.message : String(err)
        }, { channelId: channelID, destination: 'both' });
    }
}