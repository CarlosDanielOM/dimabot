import { Schema, model, Types } from 'mongoose';

export interface ILiveChannel {
    channelID: string;
    channel: string;
    streamId?: string;
    title?: string;
    gameName?: string;
    viewers: number;
    profileImageUrl?: string;
    startedAt?: string;
    fetchedAt?: string;
    botPlatforms: ('twitch' | 'kick')[];
}

export interface ISiteAnalytics {
    _id?: Types.ObjectId;
    singletonKey: string;
    registeredUsers: number;
    liveUsers: number;
    totalLiveViewers: number;
    authorizedAccounts: number;
    totalMessages: number;
    totalCommands: number;
    liveChannels: ILiveChannel[];
    created_at?: Date;
    updated_at?: Date;
}

const liveChannelSchema = new Schema<ILiveChannel>({
    channelID: { type: String, default: '' },
    channel: { type: String, default: '' },
    streamId: { type: String, default: '' },
    title: { type: String, default: '' },
    gameName: { type: String, default: '' },
    viewers: { type: Number, default: 0 },
    profileImageUrl: { type: String, default: '' },
    startedAt: { type: String, default: '' },
    fetchedAt: { type: String, default: '' },
    botPlatforms: {
        type: [{ type: String, enum: ['twitch', 'kick'] }],
        default: []
    }
}, { _id: false });

const siteAnalyticsSchema = new Schema<ISiteAnalytics>({
    singletonKey: { type: String, required: true, unique: true, default: 'global' },
    registeredUsers: { type: Number, default: 0 },
    liveUsers: { type: Number, default: 0 },
    totalLiveViewers: { type: Number, default: 0 },
    authorizedAccounts: { type: Number, default: 0 },
    totalMessages: { type: Number, default: 0 },
    totalCommands: { type: Number, default: 0 },
    liveChannels: {
        type: [liveChannelSchema],
        default: []
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export const SiteAnalyticsSchema = model<ISiteAnalytics>('site_analytics', siteAnalyticsSchema);
