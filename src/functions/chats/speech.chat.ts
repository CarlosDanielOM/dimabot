import { getUrl } from '../../utils/dev.js';
import { error as logError } from "../../utils/logger.js";

interface SpeechResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: any;
}

export async function speach(messageID: string, message: string, channelID: string): Promise<SpeechResponse> {
    try {
        const response = await fetch(`${getUrl()}/speech/${channelID}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                speach: message,
                msgID: messageID
            })
        });

        if (response.status !== 200) {
            return {
                error: true,
                message: 'Error al enviar mensaje',
                status: response.status,
                type: 'error'
            };
        }

        const data = await response.json();

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status,
                type: data.error
            };
        }

        return {
            error: false,
            message: 'Speech sent successfully',
            data: data.data
        };
    } catch (err) {
        await logError({ function: 'speach',
            messageID,
            message,
            channelID,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
