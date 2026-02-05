import { Schema, model, Types } from 'mongoose';

export interface IChannelConfig {
    _id: Types.ObjectId;
    channel_id: Types.ObjectId;
    channel: string;
    commands: any[];
    createdAt: Date;
    date: {
        day: string;
        month: string;
        year: string;
    };
}

const channelConfigSchema = new Schema<IChannelConfig>({
    channel_id: Schema.Types.ObjectId,
    channel: String,
    commands: Array,
    createdAt: Date,
    date: {
        day: String,
        month: String,
        year: String,
    },
});

export const ChannelConfigSchema = model<IChannelConfig>('channelconfig', channelConfigSchema);
