require('dotenv').config();
const tmi = require('tmi.js');
const STREAMERS = require('../class/streamer');
const { getClientOpts } = require('./dev');

let client = null;
let isClientConnected = false;

const options = getClientOpts();

async function clientConnect() {
    try {
        client = new tmi.Client(options);
        await client.connect();
        isClientConnected = true;

        client.on('connecting', (address, port) => {
            console.log(`* Twitch client trying to Connect to ${address}:${port}`);
        })

        client.on('connected', (address, port) => {
            console.log(`* Twitch CLient Connected to ${address}:${port}`);
        })

        client.on('connect', (address, port) => {
            console.log(`* Twitch Client Connect to ${address}:${port}`);
        })
    } catch (error) {
        console.error('Error connecting to Twitch: ', error);
    }
}

function getClient() {
    return client;
}

async function connectChannels() {
    const streamers = await STREAMERS.getStreamers();
    if(!isClientConnected) {
        console.error('Client not connected');
        return;
    }
    for (let i = 0; i < streamers.length; i++) {
        try {
            // Only join channels that have chat_enabled set to true
            if (streamers[i].chat_enabled === 'true') {
                await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 second delay
                await client.join(streamers[i].name);
            }
        } catch (error) {
            console.error(`Error connecting to channel ${streamers[i].name}: ${error}`);
        }
    }
}

async function connectChannel(channel) {
    let client = getClient();
    if(!isClientConnected) {
        console.error('Client not connected');
        return;
    }
    try {
        await getClient().join(channel);
    } catch (error) {
        console.error(`Error connecting to channel ${channel}: ${error}`);
    }
}

function disconnectChannel(channel) {
    try {
        client.part(channel);
    } catch (error) {
        console.error(`Error disconnecting from channel ${channel}, error: ${error}`);
    }
}

module.exports = {
    clientConnect,
    getClient,
    connectChannels,
    connectChannel,
    disconnectChannel
}