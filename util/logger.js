const { getClient } = require("./database/dragonfly");

async function logger(data, cache = false, channelID = null, type = null, showConsole = true) {
    let cacheClient = getClient();

    if(cache) {
        let uniqueID = `${channelID}-${type}-${Date.now().toLocaleString('en-US', {timeZone: 'UTC'})}`;
        await cacheClient.set(`logger:${channelID}:${type}:${uniqueID}`, JSON.stringify({data, timestamp: new Date().toLocaleString('en-US', {timeZone: 'UTC'})}));
        await cacheClient.expire(`logger:${channelID}:${type}:${uniqueID}`, 60 * 60 * 24 * 7);
    }

    if(showConsole) console.log({data, timestamp: new Date().toLocaleString('en-US', {timeZone: 'UTC'})})
    
}

module.exports = logger;