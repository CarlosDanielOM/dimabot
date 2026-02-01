import { getUrl } from '../../utils/dev.js';

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
    } catch (error) {
        console.error(`Error in speach:`, {
            messageID,
            message,
            channelID,
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
