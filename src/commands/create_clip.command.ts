import { createClip, getClip } from '../functions/clips/index.js';
import { error } from '../utils/logger.js';

interface CreateClipCommandResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    clipID?: string;
    clipData?: any;
    data?: any;
}

interface CreateClipOptions {
    duration?: number;
    title?: string;
}

const DEFAULT_CLIP_DURATION = 30;
const MIN_CLIP_DURATION = 5;
const MAX_CLIP_DURATION = 60;

function parseClipOptions(argument?: string): CreateClipOptions {
    const trimmedArgument = argument?.trim();

    if (!trimmedArgument) {
        return {};
    }

    const [firstToken, ...restTokens] = trimmedArgument.split(/\s+/);
    const parsedNumber = Number(firstToken);
    const firstTokenIsNumber = !isNaN(parsedNumber);

    if (!firstTokenIsNumber) {
        return {
            title: trimmedArgument
        };
    }

    const duration = parsedNumber >= MIN_CLIP_DURATION && parsedNumber <= MAX_CLIP_DURATION
        ? parsedNumber
        : DEFAULT_CLIP_DURATION;

    const title = restTokens.join(' ').trim();

    return {
        duration,
        title: title || undefined
    };
}

async function checkClipStatus(clipID: string, retries: number = 0): Promise<CreateClipCommandResponse> {
    const getClipFun = await getClip(clipID);

    if (getClipFun.error) {
        if (getClipFun.status === 404 && retries < 15) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return checkClipStatus(clipID, retries + 1);
        }
        return {
            error: getClipFun.error ?? true,
            message: getClipFun.message,
            status: getClipFun.status,
            type: getClipFun.type,
            data: getClipFun.data
        };
    }

    return {
        error: getClipFun.error ?? false,
        message: getClipFun.message,
        status: getClipFun.status,
        type: getClipFun.type,
        data: getClipFun.data
    };
}

export async function createClipCommand(channelID: string, argument?: string): Promise<CreateClipCommandResponse> {
    try {
        const clipOptions = parseClipOptions(argument);
        const createClipFun = await createClip(channelID, clipOptions);

        if (createClipFun.status === 503) {
            return {
                error: true,
                message: 'Clip creation is currently unavailable.',
                status: 503,
                type: 'Clip creation unavailable'
            };
        }

        if (createClipFun.status && createClipFun.status > 500) {
            return {
                error: true,
                message: 'There was an internal Twitch server error that we cannot resolve.',
                status: createClipFun.status,
                type: 'Clip creation error'
            };
        }

        if (createClipFun.error) {
            return {
                error: createClipFun.error ?? true,
                message: createClipFun.message || 'Error creating clip',
                status: createClipFun.status,
                type: createClipFun.type
            };
        }

        const clipID = createClipFun.clipID;

        if (!clipID) {
            return {
                error: true,
                message: 'Clip ID not returned from creation',
                status: 500,
                type: 'Clip creation error'
            };
        }

        const clipData = await checkClipStatus(clipID);

        if (clipData.status === 404) {
            return {
                error: true,
                message: 'There was an error finding the clip, it may have been created but is taking too long to process. Please check your clips later.',
                status: 404,
                type: 'Clip not found'
            };
        }

        if (clipData.error) {
            return clipData;
        }

        if (!clipData.data) {
            return {
                error: true,
                message: 'There was an unexpected error retrieving the clip data.',
                status: 500,
                type: 'Clip data missing'
            };
        }

        return {
            error: false,
            message: `Clip created successfully: ${clipData.data.url}`,
            clipData: clipData.data,
            status: 200,
            type: 'Clip created'
        };
    } catch (err) {
        await error({
            function: 'createClipCommand',
            channelID,
            argument,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { channelId: channelID, destination: 'both' });

        return {
            error: true,
            message: 'Internal server error'
        };
    }
}
