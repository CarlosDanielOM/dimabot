const mongoose = require('mongoose');
const schema = mongoose.Schema;

const channelSchema = new schema({
    name: String,
    email: String,
    type: { type: String, default: 'twitch' }, // 'twitch' or 'youtube'
    premium: { type: Boolean, default: false },
    premium_plus: { type: Boolean, default: false },
    premium_until: { type: Date, default: null },
    actived: { type: Boolean, default: false }, // Bot token refresh status
    chat_enabled: { type: Boolean, default: false }, // Bot chat activity status
    twitch_user_id: String,
    twitch_user_token: { iv: String, content: String },
    twitch_user_refresh_token: { iv: String, content: String },
    twitch_user_token_id: { type: String, default: null },
    up_to_date_twitch_permissions: { type: Boolean, default: true },
    polar_sh_customer_id: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    refreshedAt: { type: Date, default: Date.now },
    date: {
        day: { type: Number, default: () => new Date().getDate() },
        month: { type: Number, default: () => new Date().getMonth() + 1 },
        year: { type: Number, default: () => new Date().getFullYear() },
    }
});

const Channel = mongoose.model('Channel', channelSchema);

module.exports = Channel;