import { Schema, model, Types } from 'mongoose';

export interface IEventConfigLabel {
    EN: string;
    ES: string;
}

export interface IEventConfigShowIf {
    controlId: string;
    is: any;
}

export interface IEventConfig {
    id: string;
    label: IEventConfigLabel;
    type: 'text' | 'number' | 'checkbox' | 'select' | 'message-tiers';
    value: any;
    canDisable: boolean;
    showIf?: IEventConfigShowIf;
}

export interface IEventTierLimits {
    basic: number;
    premium: number;
    premium_plus: number;
}

export interface IEventDescription {
    EN: string;
    ES: string;
}

export interface IEvent {
    _id: Types.ObjectId;
    name: string;
    type: string;
    version: string;
    condition: any;
    icon: string;
    color: string;
    textColor: string;
    releaseStage: 'stable' | 'beta' | 'alpha' | 'maintenance' | 'coming_soon' | 'unavailable' | 'deprecated';
    enabled: boolean;
    premium: boolean;
    premium_plus: boolean;
    description: IEventDescription;
    config: IEventConfig[];
    tierLimits: IEventTierLimits;
    createdAt: Date;
    updatedAt: Date;
}

const eventSchema = new Schema<IEvent>({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    type: {
        type: String,
        required: true,
        trim: true,
    },
    version: {
        type: String,
        required: true,
        default: '1',
    },
    condition: {
        type: Schema.Types.Mixed,
        required: true,
    },
    icon: {
        type: String,
        required: true,
        trim: true,
    },
    color: {
        type: String,
        required: true,
        trim: true,
    },
    textColor: {
        type: String,
        required: true,
        trim: true,
    },
    releaseStage: {
        type: String,
        enum: ['stable', 'beta', 'alpha', 'maintenance', 'coming_soon', 'unavailable', 'deprecated'],
        default: 'stable',
    },
    enabled: {
        type: Boolean,
        default: false,
    },
    premium: {
        type: Boolean,
        default: false,
    },
    premium_plus: {
        type: Boolean,
        default: false,
    },
    description: {
        EN: {
            type: String,
            required: true,
            trim: true,
        },
        ES: {
            type: String,
            required: true,
            trim: true,
        },
    },
    config: [
        {
            id: {
                type: String,
                required: true,
                trim: true,
            },
            label: {
                EN: {
                    type: String,
                    required: true,
                    trim: true,
                },
                ES: {
                    type: String,
                    required: true,
                    trim: true,
                },
            },
            type: {
                type: String,
                required: true,
                enum: ['text', 'number', 'checkbox', 'select', 'message-tiers'],
                default: 'text',
            },
            value: {
                type: Schema.Types.Mixed,
                required: true,
            },
            canDisable: {
                type: Boolean,
                default: false,
            },
            showIf: {
                type: new Schema(
                    {
                        controlId: { type: String, required: true },
                        is: { type: Schema.Types.Mixed, required: true },
                    },
                    { _id: false },
                ),
                required: false,
                validate: {
                    validator: function (value: IEventConfigShowIf | undefined) {
                        if (value !== undefined && value !== null) {
                            return value.controlId !== undefined && value.is !== undefined;
                        }
                        return true;
                    },
                    message: 'If showIf is provided, both controlId and is must be defined',
                },
            },
        },
    ],
    tierLimits: {
        basic: {
            type: Number,
            default: 0,
        },
        premium: {
            type: Number,
            default: 2,
        },
        premium_plus: {
            type: Number,
            default: 5,
        },
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

eventSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

export const EventSchema = model<IEvent>('Event', eventSchema);
