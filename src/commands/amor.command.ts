interface Tags {
    'display-name': string;
    username: string;
}

interface AmorResponse {
    error: boolean;
    message: string;
    type?: string;
}

export async function amorCommand(tags: Tags, argument?: string): Promise<AmorResponse> {
    try {
        let touser = argument ?? null;
        let user = tags['display-name'];

        if (!touser) {
            return {
                error: true,
                message: `Se te olvido poner a la persona a la que quieres medir el amor. No mas por eso te quedaras solter@ toda tu vida.`,
                type: 'No user'
            };
        }

        let viewers = touser.split(' ');
        let user1 = viewers[0];
        let user2 = viewers[1] ?? null;

        let multiple = false;

        if (user2) {
            user = user1;
            touser = user2.replace('@', '');
            multiple = true;
        }

        if (touser.toLowerCase() === tags.username && !multiple) {
            return {
                error: true,
                message: `No puedes medir tu amor propio. Eso es narcisismo.`,
                type: 'Self love'
            };
        }

        let love = Math.floor(Math.random() * 101);

        if (love > 100) love = 100;

        return {
            error: false,
            message: `El amor entre ${user} y ${touser} es de ${love}%`
        };
    } catch (error) {
        console.error(`Error in amorCommand:`, {
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
