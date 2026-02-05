import { Schema, model, Types } from 'mongoose';

export interface IChatLog {
    _id: Types.ObjectId;
    channel: string;
    message: string;
    username: string;
    timestamp: Date;
}

const chatLogSchema = new Schema<IChatLog>({
    channel: String,
    message: String,
    username: String,
    timestamp: { type: Date, default: Date.now },
});

export const ChatLogSchema = model<IChatLog>('Chat_Log', chatLogSchema);
