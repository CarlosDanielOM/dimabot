import { Schema, model, Types } from 'mongoose';

export interface ICommandUserVariables {
    commandId: Types.ObjectId;
    channelID: string;
    userId: string;
    variables: Map<string, string>;
    createdAt?: Date;
    updatedAt?: Date;
}

const commandUserVariablesSchema = new Schema<ICommandUserVariables>({
    commandId: { 
        type: Schema.Types.ObjectId, 
        required: true, 
        ref: 'Commands' 
    },
    channelID: { 
        type: String, 
        required: true, 
        index: true 
    },
    userId: { 
        type: String, 
        required: true, 
        index: true 
    },
    variables: {
        type: Map,
        of: String,
        default: {}
    }
}, { 
    timestamps: true 
});

commandUserVariablesSchema.index({ commandId: 1, userId: 1 }, { unique: true });

export const CommandUserVariablesSchema = model<ICommandUserVariables>(
    'CommandUserVariables', 
    commandUserVariablesSchema
);
