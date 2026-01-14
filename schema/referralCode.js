const mongoose = require('mongoose');
const schema = mongoose.Schema;

const referralCodeSchema = new schema({
    code: {
        type: String,
        required: true,
        unique: true,
        validate: {
            validator: function(v) {
                return /^[a-zA-Z0-9_]{1,16}$/.test(v);
            },
            message: props => `${props.value} is not a valid referral code. Must be 1-16 alphanumeric characters or underscores.`
        },
        index: true
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Channel',
        required: true,
        index: true
    },
    label: {
        type: String,
        maxlength: 50,
        default: ''
    },
    stats: {
        conversions: { type: Number, default: 0 }
    },
    active: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Compound index for efficient owner lookups
referralCodeSchema.index({ owner: 1, createdAt: -1 });

// Case-insensitive lookup helper
referralCodeSchema.statics.findByCode = function(code) {
    return this.findOne({ code: code.toLowerCase(), active: true });
};

// Pre-save hook to normalize code to lowercase
referralCodeSchema.pre('save', function(next) {
    if (this.isModified('code')) {
        this.code = this.code.toLowerCase();
    }
    next();
});

const ReferralCode = mongoose.model('ReferralCode', referralCodeSchema);

module.exports = ReferralCode;
