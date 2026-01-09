const { getClient } = require('../../util/database/dragonfly');

const AI_USAGE_METER_ID = '01d90c16-87d0-4e31-880a-4045a8da90cd';

async function polarSHEventsHandler(eventData) {
    const cacheClient = getClient();

    switch(eventData.type) {
        case 'customer.state_changed': {
            const channelID = eventData.data.metadata?.twitch_channel_id;
            if (!channelID) {
                console.error('Polar.sh webhook: Missing twitch_channel_id in metadata');
                return;
            }

            const activeMeters = eventData.data.active_meters || [];
            const aiMeter = activeMeters.find(meter => meter.meter_id === AI_USAGE_METER_ID);

            if (!aiMeter) {
                return;
            }

            if (aiMeter.balance <= 0) {
                await cacheClient.set(`${channelID}:ai:exhaust`, 'true');
            } else {
                await cacheClient.del(`${channelID}:ai:exhaust`);
            }
            break;
        }
    }
}

module.exports = polarSHEventsHandler;