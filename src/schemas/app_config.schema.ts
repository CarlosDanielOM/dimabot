import { Schema, model, Types } from 'mongoose';

export interface IAppConfig {
    _id: Types.ObjectId;
    name: string;
    access_token: { iv: string; content: string };
    refreshed_at: Date;
}

const appConfigSchema = new Schema<IAppConfig>({
    name: String,
    access_token: {
        iv: String,
        content: String,
    },
    refreshed_at: { type: Date, default: Date.now },
});

appConfigSchema.pre('save', function (next) {
    this.refreshed_at = new Date();
    next();
});

export const AppConfigSchema = model<IAppConfig>('app_config', appConfigSchema);
