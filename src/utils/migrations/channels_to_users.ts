import UsersSchema from "../../schemas/users.schema.js";
import mongoose, { Types } from "mongoose";
import type { IUsers } from "../../schemas/users.schema.js";

export async function channelsToUsers() {
    try {
        const Channels = await mongoose.connection.db?.collection('channels').find({}).toArray();

        const users = await UsersSchema.find({});

        const usersMap = new Map<string, IUsers>();
        
        for(const channel of Channels ?? []) {

            const userData: Partial<IUsers> = {
                _id: channel._id as Types.ObjectId,
                name: channel.name,
                email: channel.email,
                polar_sh_customer_id: channel.polar_sh_customer_id,
                plan_tier: 'free',
                plan_tier_until: null,
                refreshed_at: channel.refreshedAt,
                created_at: channel.createdAt,
                updated_at: channel.updatedAt,
                accounts: [{
                    _id: new Types.ObjectId(),
                    type: 'twitch',
                    id: channel.twitch_user_id,
                    name: channel.name,
                    email: channel.email,
                    refresh_token: {
                        iv: channel.twitch_user_token?.iv ?? null,
                        content: channel.twitch_user_token?.content ?? null,
                    },
                    access_token: {
                        iv: channel.twitch_user_refresh_token?.iv ?? null,
                        content: channel.twitch_user_refresh_token?.content ?? null,
                    },
                    actived: channel.actived,
                    chat_enabled: channel.chat_enabled,
                    has_permissions: channel.up_to_date_twitch_permissions ?? false,
                    up_to_date_permissions: channel.up_to_date_twitch_permissions ?? false,
                }],
            }
            
            await UsersSchema.create(userData);
        }


        console.log(`Found ${Channels?.length ?? 0} channels to migrate`);
    } catch (error) {
        console.error(`Error migrating channels to users: ${error}`);
        return { success: false, message: `Error migrating channels to users: ${error}` };
    }
}
