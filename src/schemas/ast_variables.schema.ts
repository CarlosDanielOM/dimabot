import { Schema, model } from 'mongoose';

export interface IAstVariables {
    channelID: string;
    scopeType: string;
    scopeName: string;
    userId: string;
    userLogin: string;
    variables: Map<string, string>;
    createdAt?: Date;
    updatedAt?: Date;
}

const astVariablesSchema = new Schema<IAstVariables>({
    channelID: {
        type: String,
        required: true,
        index: true
    },
    scopeType: {
        type: String,
        required: true,
        default: 'command'
    },
    scopeName: {
        type: String,
        required: true,
        default: 'default'
    },
    userId: {
        type: String,
        required: true,
        default: ''
    },
    userLogin: {
        type: String,
        required: true,
        default: ''
    },
    variables: {
        type: Map,
        of: String,
        default: {}
    }
}, {
    timestamps: true
});

astVariablesSchema.index({ channelID: 1, scopeType: 1, scopeName: 1, userId: 1 }, { unique: true });
astVariablesSchema.index({ channelID: 1, scopeType: 1, scopeName: 1, userLogin: 1 }, { unique: true });

export const AstVariablesSchema = model<IAstVariables>('AstVariables', astVariablesSchema);
