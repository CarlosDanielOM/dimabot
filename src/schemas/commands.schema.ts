import { Schema, model } from 'mongoose';

export interface ICommands {
    name: string;
    cmd: string;
    func: string;
    message: string;
    responses: string[];
    type: string;
    platform: string;
    reserved: boolean;
    description: string;
    cooldown: number;
    count: number;
    userLevelName: string;
    userLevel: number;
    permissions: Record<string, boolean>;
    enabled: boolean;
    paused: boolean;
    channel: string;
    channelID: string;
    premiumRequired: boolean;
    premiumLevelRequired: number;
    createdAt: Date;
    date: {
        day: number;
        month: number;
        year: number;
    };
}

const commandsSchema = new Schema({
    name: String,
    cmd: String,
    func: String,
    message: { type: String, default: '' },
    responses: { type: Array, default: [] },
    type: { type: String, default: 'command' },
    platform: {type: String, default: 'twitch'},
    reserved: { type: Boolean, default: false },
    description: { type: String, default: 'No description provided.' },
    cooldown: { type: Number, default: 20 },
    count: { type: Number, default: 0 },
    userLevelName: { type: String, default: 'everyone' },
    userLevel: { type: Number, default: 0 },
    permissions: { type: Object, default: {} },
    enabled: { type: Boolean, default: true },
    paused: { type: Boolean, default: false },
    channel: String,
    channelID: { type: String, required: true },
    premiumRequired: { type: Boolean, default: false },
    premiumLevelRequired: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    date: {
        day: { type: Number, default: () => new Date().getDate() },
        month: { type: Number, default: () => new Date().getMonth() + 1 },
        year: { type: Number, default: () => new Date().getFullYear() },
    }
})

export const CommandsSchema = model<ICommands>('Commands', commandsSchema);