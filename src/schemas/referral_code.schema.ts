import { Schema, model, Types, Model } from 'mongoose';

export interface IReferralCodeStats {
    conversions: number;
}

export interface IReferralCode {
    _id: Types.ObjectId;
    code: string;
    owner: Types.ObjectId;
    label: string;
    stats: IReferralCodeStats;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface IReferralCodeModel extends Model<IReferralCode> {
    findByCode(code: string): Promise<IReferralCode | null>;
}

const referralCodeSchema = new Schema<IReferralCode, IReferralCodeModel>(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            validate: {
                validator: function (v: string) {
                    return /^[a-zA-Z0-9_]{1,16}$/.test(v);
                },
                message: (props: any) => `${props.value} is not a valid referral code. Must be 1-16 alphanumeric characters or underscores.`,
            },
            index: true,
        },
        owner: {
            type: Schema.Types.ObjectId,
            ref: 'Channel',
            required: true,
            index: true,
        },
        label: {
            type: String,
            maxlength: 50,
            default: '',
        },
        stats: {
            conversions: { type: Number, default: 0 },
        },
        active: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true },
);

referralCodeSchema.index({ owner: 1, createdAt: -1 });

referralCodeSchema.statics.findByCode = function (code: string) {
    return this.findOne({ code: code.toLowerCase(), active: true });
};

referralCodeSchema.pre('save', function (next) {
    if (this.isModified('code')) {
        this.code = this.code.toLowerCase();
    }
    next();
});

export const ReferralCodeSchema = model<IReferralCode, IReferralCodeModel>('ReferralCode', referralCodeSchema);
