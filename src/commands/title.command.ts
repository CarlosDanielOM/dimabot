import { getChannelInformation, setChannelInformation } from '../functions/channels/index.js';

interface TitleResponse {
    error: boolean;
    message: string;
    status?: number;
    type?: string;
}

export async function titleCommand(
    channelID: string,
    title: string | null,
    userLevel: number = 1,
    commandLevel: number = 7,
    premium: string = 'false'
): Promise<TitleResponse> {
    try {
        if (!title || userLevel < commandLevel) {
            const data = await getChannelInformation(channelID);

            if (data.error || !data.data) {
                return {
                    error: true,
                    message: data.message || 'Failed to get channel information'
                };
            }

            const currentTitle = data.data.title;

            return {
                error: false,
                message: `The title for this stream is: ${currentTitle}`,
                status: 200,
                type: 'success'
            };
        }

        // Premium feature commented out - titleConfigSchema not migrated yet
        // if (premium == 'true') {
        //     let titleConfig = await titleConfigSchema.findOne({ channelID: channelID });
        //     if (titleConfig) {
        //         let pretitle = titleConfig.pretitle;
        //         let posttitle = titleConfig.posttitle;
        //         title = `${pretitle} ${title} ${posttitle}`;
        //     }
        // }

        const titleData = await setChannelInformation(channelID, { title: title });
        if (titleData.error) {
            return titleData;
        }

        return {
            error: false,
            message: `The title for this stream has been updated to: ${title}`,
            status: 200,
            type: 'success'
        };
    } catch (error) {
        console.error(`Error in titleCommand:`, {
            channelID,
            title,
            userLevel,
            commandLevel,
            premium,
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
