import { Schema, model, Types } from "mongoose";
import UsersSchema from "./users.schema.js";

interface IKnownUser {
    username: string;
    description: string;
    lastInteraction: Date;
    relationship: string;
}

const knownUserSchema = new Schema<IKnownUser>({
    username: { type: String, default: '' },
    description: { type: String, default: '' },
    lastInteraction: { type: Date, default: Date.now },
    relationship: { type: String, default: '' }
});

export interface IChannelAIPersonality {
    _id: Types.ObjectId;
    channelID: string;
    channel: string;
    personality: string;
    rules: string[];
    knownUsers: IKnownUser[];
    contextWindow: number;
    createdAt: Date;
    updatedAt: Date;
}

const channelAIPersonalitySchema = new Schema<IChannelAIPersonality>({
    channelID: { type: String, required: true },
    channel: { type: String, required: true },
    personality: {
        type: String,
        required: true,
        default: "You are a friendly Twitch chat moderator who speaks in Spanish by default but can adapt to other languages. You have a good sense of humor and can be playful with chat users."
    },
    rules: [{
        type: String,
        required: true,
        default: "Be respectful and friendly with users"
    }],
    knownUsers: [knownUserSchema],
    contextWindow: {
        type: Number,
        required: true,
        default: 7
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

channelAIPersonalitySchema.pre('save', async function(next) {
    const user = await UsersSchema.findOne({
        'accounts.type': 'twitch',
        'accounts.id': this.channelID
    } as any);

    if (!user) {
        throw new Error('User not found for channel');
    }

    if (user.plan_tier === 'pro') {
        this.contextWindow = 15;
        return next();
    }

    if (user.plan_tier === 'premium') {
        if (this.rules.length > 5) {
            throw new Error('Premium channels can only have up to 5 rules');
        }
        if (this.knownUsers.length > 10) {
            throw new Error('Premium channels can only have up to 10 known users');
        }
        this.contextWindow = 7;
    } else {
        if (this.rules.length > 3) {
            throw new Error('Free channels can only have up to 3 rules');
        }
        if (this.knownUsers.length > 3) {
            throw new Error('Free channels can only have up to 3 known users');
        }
        this.contextWindow = 3;
    }

    next();
});

export const ChannelAIPersonalitySchema = model<IChannelAIPersonality>('ChannelAIPersonality', channelAIPersonalitySchema);
