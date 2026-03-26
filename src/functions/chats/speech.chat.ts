import { getUrl } from '../../utils/dev.js';
import { error as logError } from "../../utils/logger.js";

interface SpeechResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    data?: any;
}

export interface TtsRequestBody {
    mode: 'speak' | 'ai' | 'clone';
    text: string;
    language?: 'en' | 'es';
    cloneName?: string;
    requestedBy?: {
        userID?: string;
        userLogin?: string;
        userName?: string;
        userLevel?: number;
    };
    meta?: {
        source?: 'chat-command' | 'ast' | 'redemption';
        originalText?: string;
        skipEmotes?: boolean;
        stripLinks?: boolean;
    };
}

export async function requestTts(channelID: string, payload: TtsRequestBody): Promise<SpeechResponse> {
    try {
        const internalApiUrl = process.env.INTERNAL_API_URL || getUrl();
        const response = await fetch(`${internalApiUrl}/speech/${channelID}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => null) as SpeechResponse | null;

        if (response.status < 200 || response.status > 299) {
            return {
                error: true,
                message: data?.message || 'Error al enviar mensaje',
                status: response.status,
                type: 'error'
            };
        }

        if (!data) {
            return {
                error: true,
                message: 'Invalid response from speech service',
                status: response.status,
                type: 'error'
            };
        }

        if (data.error) {
            return {
                error: true,
                message: data.message,
                status: data.status,
                type: 'error'
            };
        }

        return {
            error: false,
            message: 'Speech sent successfully',
            data: data.data
        };
    } catch (err) {
        await logError({ function: 'requestTts',
            channelID,
            payload,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
        });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}

export async function speach(messageID: string, message: string, channelID: string): Promise<SpeechResponse> {
    return await requestTts(channelID, {
        mode: 'speak',
        text: message,
        meta: {
            source: 'chat-command',
            originalText: messageID
        }
    });
}
