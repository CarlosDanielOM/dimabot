import { Schema, model, Types } from 'mongoose';

export interface IAccounts {
    _id: Types.ObjectId;
    user_id: string;
    user_login: string;
    user_email: string;
    channelID: string;
    channelName: string;
    user_type: string;
    user_token: { iv: string; content: string };
    user_refresh_token: { iv: string; content: string };
    createdAt: Date;
}

const accountsSchema = new Schema<IAccounts>({
    user_id: { type: String, default: null },
    user_login: { type: String, default: null },
    user_email: { type: String, default: null },
    channelID: { type: String, default: null },
    channelName: { type: String, default: null },
    user_type: { type: String, default: '' },
    user_token: { iv: String, content: String },
    user_refresh_token: { iv: String, content: String },
    createdAt: { type: Date, default: Date.now },
});

export const AccountsSchema = model<IAccounts>('Account', accountsSchema);
