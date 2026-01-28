import {Schema, model} from 'mongoose';

export interface ITransport {
    method: string;
    callback: string;
}

export interface ICheerTiers {
    id: string;
    name: string;
    message: string;
    min_amount: number;
    max_amount: number;
}

export interface ICondition {
    broadcaster_user_id?: string;
    user_id?: string;
    moderator_user_id?: string;
    from_broadcaster_user_id?: string;
    to_broadcaster_user_id?: string;
}

export interface IEventsub {
    id: string;
    status: string;
    type: string;
    version: string;
    condition: ICondition;
    created_at: string;
    transport: ITransport;
    cost: number;
    channel: string;
    channelID: string;
    enabled: boolean;
    message: string;
    endMessage: string;
    endEnabled: boolean;
    minViewers: number;
    temporalBanMessage: string;
    clipEnabled: boolean;
    delay: number;
    cheerTiers: ICheerTiers[];
}

const eventsubSchema = new Schema<IEventsub>({
    id: { type: String, required: true },
    status: { type: String, required: true },
    type: { type: String, required: true },
    version: { type: String, required: true },
    condition: { type: Object, required: true },
    created_at: { type: String, required: true },
    transport: { type: Object, required: true },
    cost: { type: Number, required: true },
    channel: { type: String, required: true },
    channelID: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    message: { type: String, default: '' },
    endMessage: { type: String, default: '' },
    endEnabled: { type: Boolean, default: false },
    minViewers: { type: Number, default: 2 },
    temporalBanMessage: { type: String, default: '' },
    clipEnabled: { type: Boolean, default: false },
    delay: { type: Number, default: 0 },
    cheerTiers: { type: [Object], default: [] },
});

const EventsubSchema = model('eventsub', eventsubSchema);

export default EventsubSchema;