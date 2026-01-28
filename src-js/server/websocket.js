const { Server } = require('socket.io');
const http = require('http');
const { getClient } = require('../../util/database/dragonfly');
const fs = require('fs');

const STREAMERS = require('../../class/streamer');
const promo = require('../../command/promo');
const { getSiteAnalytics } = require('../../util/siteanalytics');

let io = null;

async function websocket(app) {
    let server = http.createServer(app);
    io = new Server(server, {
        connectionStateRecovery: {}
    });

    //? Speach
    io.of(/^\/speech\/\w+$/).on('connection', async (socket) => {
        let cacheClient = getClient();
        const channelID = socket.nsp.name.split('/')[2];
        console.log(`${channelID} connected to speech`);

        let messages = await cacheClient.scard(`${channelID}:speach`);

        if(messages > 0) {
            let messageQueue = await cacheClient.smembers(`${channelID}:speach`);
            let id = messageQueue[0];
            io.of(`/speech/${channelID}`).emit('speach', { id });
        }

        socket.on('disconnect', () => {
            console.log(`${channelID} disconnected from speech`);
        });

        socket.on('end', async (data) => {
            let fileExists = fs.existsSync(`${__dirname}/routes/public/speach/${data.id}.mp3`);

            if(!fileExists) {
                let messages = await cacheClient.smembers(`${channelID}:speach`);
                let id = messages[0];
                io.of(`/speech/${channelID}`).emit('speach', { id: id });
            }
            
            fs.unlink(`${__dirname}/routes/public/speach/${data.id}.mp3`, async (err) => {
                if (err) {
                    console.error(err);
                    return;
                }

                await cacheClient.srem(`${channelID}:speach`, data.id);

                let messages = await cacheClient.scard(`${channelID}:speach`);
    
                if(messages > 0) {
                    let messageQueue = await cacheClient.smembers(`${channelID}:speach`);
                    let id = messageQueue[0];
                    io.of(`/speech/${channelID}`).emit('speach', { id });
                }
            });
        });
    });

    //? Overlay triggers
    io.of(/^\/overlays\/triggers\/\w+$/).on('connection', async (socket) => {
        const channelID = socket.nsp.name.split('/')[3];

        let userData = await STREAMERS.getStreamerById(channelID);
        
        console.log(`${userData.name} (${channelID}) connected to triggers`);
        
        socket.on('disconnect', () => {
            console.log(`${userData.name} (${channelID}) disconnected from triggers`);
        });
    });

    //? Overlay Furry
    io.of(/^\/overlays\/furry\/\w+$/).on('connection', async (socket) => {
        let cacheClient = getClient();
        const channelID = socket.nsp.name.split('/')[3];
        console.log(`${channelID} connected to furry`);

        let value = await cacheClient.hget(`${channelID}:supremeFurry`, 'value');
        let username = await cacheClient.hget(`${channelID}:supremeFurry`, 'username');

        socket.on('disconnect', () => {
            console.log(`${channelID} disconnected from furry`);
            io.of(`/overlays/furry/${channelID}`).emit('furry', {username: '', value: ''});
            
        });

        if (value !== null && username !== null) {
            io.of(`/overlays/furry/${channelID}`).emit('furry', {username, value});
        }
    });

    //? Clip
    io.of(/^\/clip\/\w+$/).on('connection', async (socket) => {
        const channelID = socket.nsp.name.split('/')[2];
        const cacheClient = getClient();

        try {
            await cacheClient.del(`${channelID}:clip:playing`);
            await cacheClient.del(`${channelID}:clip:connected`);
        } catch (error) {
            console.error(`Error deleting clip cache data: ${error}`);
        }

        let userData = await STREAMERS.getStreamerById(channelID);

        await cacheClient.set(`${channelID}:clip:connected`, "true");
        console.log(`${userData.name} (${channelID}) connected to clip`);

        let clipQueue = await cacheClient.lrange(`${channelID}:clips:queue`, 0, -1);
        if(clipQueue.length > 0) {
            let streamerName = await cacheClient.lpop(`${channelID}:clips:queue`);
            promo(channelID, streamerName, true);
            cacheClient.set(`${channelID}:clip:playing`, "true");
        }

        socket.on('clip-ended', async (data) => {
            //? If the queue is empty, stop the clip
            let exists = await cacheClient.exists(`${channelID}:clips:queue`);
            if(!exists) {
                cacheClient.del(`${channelID}:clip:playing`);
            }
            
            let nextStreamer = await cacheClient.lpop(`${channelID}:clips:queue`);
            let duplicateExists = await cacheClient.exists(`${channelID}:clips:queue:first`);
            if(duplicateExists) {
                if(nextStreamer == await cacheClient.get(`${channelID}:clips:queue:first`)) {
                    nextStreamer = await cacheClient.lpop(`${channelID}:clips:queue`);
                    cacheClient.del(`${channelID}:clips:queue:first`);
                }
            }

            if(!nextStreamer) {
                cacheClient.del(`${channelID}:clip:playing`);
                cacheClient.del(`${channelID}:clips:queue:first`);
            }
            
            //? Waits 0.5 seconds before sending the next clip
            setTimeout(async () => {
                if(nextStreamer) {
                    promo(channelID, nextStreamer, true);
                }
            }, 500);
        });

        socket.on('disconnect', () => {
            console.log(`${userData.name} (${channelID}) disconnected from clip`);
            cacheClient.del(`${channelID}:clip:connected`);
        });

    });
    
    //? Sumimetro
    io.of(/^\/sumimetro\/\w+\/\w+$/).on('connection', async (socket) => {
        const cacheClient = getClient();
        const type = socket.nsp.name.split('/')[2];
        const channelID = socket.nsp.name.split('/')[3];

        if(type == 'sumiso') {
            let value = await cacheClient.hget(`${channelID}:sumimetro:submissive`, 'value');
            let username = await cacheClient.hget(`${channelID}:sumimetro:submissive`, 'user');
            
            if (value !== null && username !== null) {
                socket.emit('sumimetro', {username, value});
            }
        }

        if(type == 'dominante') {
            let value = await cacheClient.hget(`${channelID}:sumimetro:dominant`, 'value');
            let username = await cacheClient.hget(`${channelID}:sumimetro:dominant`, 'user');
            
            if (value !== null && username !== null) {
                socket.emit('sumimetro', {username, value});
            }
        }

        socket.on('disconnect', () => {
            console.log(`${channelID} disconnected from sumimetro ${type}`);
        });
    });

    //? Site Global Data Analytics
    io.of(/^\/site\/analytics\/[\w-]+$/).on('connection', async (socket) => {
        const type = socket.nsp.name.split('/')[3];
        if(type == 'live-channels') {
            let liveChannels = await getSiteAnalytics('live');
            socket.emit('live-channels', liveChannels);
        }

        if(type == 'active-channels') {
            let activeChannels = await getSiteAnalytics('active');
            socket.emit('active-channels', activeChannels);
        }

        if(type == 'registered-channels') {
            let registeredChannels = await getSiteAnalytics('registered');
            socket.emit('registered-channels', registeredChannels);
        }

        socket.on('disconnect', () => {
        });
    });

    //? PubSub

    io.on('error', (error) => {
        console.error('Websocket error:', error);
    });
    
    return server;
}

function getIO() {
    return io;
}

module.exports = {
    websocket,
    getIO
};