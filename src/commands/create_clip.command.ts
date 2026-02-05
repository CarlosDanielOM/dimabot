import { createClip, getClip } from '../functions/clips/index.js';

interface CreateClipCommandResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
    clipID?: string;
    clipData?: any;
    data?: any;
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

export async function createClipCommand(channelID: string): Promise<CreateClipCommandResponse> {
    try {
        const createClipFun = await createClip(channelID);

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
    } catch (error) {
        console.error(`Error in createClipCommand:`, {
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
