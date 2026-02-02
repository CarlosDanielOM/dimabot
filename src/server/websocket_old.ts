import { Server } from "socket.io";
import type { Socket as SocketIOSocket } from "socket.io";
import http from "http";
import fs from "fs";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";

import TwitchStreamers from "../classes/twitch_streamers.class.js";
import { clipQueueHandler } from "../handlers/clip_queue.handler.js";

let io: Server | null = null;

export const websocket = async (app: Express.Application) => {
    try {
        
        let server = http.createServer(app);
        io = new Server(server, {
            connectionStateRecovery: {}
        });
    
        //? Speach Endpoint
        io.of(/^\/speech\/\w+$/).on('connection', async (socket) => {
            const cacheClient = await getDragonflyClient('Websocket');
            const channelId = socket.nsp.name.split('/')[2];
    
            let account = await TwitchStreamers.getTwitchAccountById(channelId);
            if(!account) {
                socket.emit('error', {
                    message: 'Account not found',
                    status: 404
                });
                return;
            }
            
            
            console.log(`${channelId} (${account.name}) connected to speech`);
    
            let messages = await cacheClient.sCard(`${channelId}:speach`);
            if(messages > 0) {
                let messageQueue = await cacheClient.sMembers(`${channelId}:speach`);
                let id = messageQueue[0];
                socket.emit('speach', { id });
            }
            
            socket.on('disconnect', () => {
                console.log(`${channelId} (${account.name}) disconnected from speech`);
            });
    
            socket.on('end', async (data: { id: string }) => {
                let fileExists = fs.existsSync(`${__dirname}/routes/public/speach/${data.id}.mp3`);
                if(!fileExists) {
                    let messages = await cacheClient.sMembers(`${channelId}:speach`);
                    let id = messages[0];
                    socket.emit('speach', { id: id });
                }
    
                fs.unlink(`${__dirname}/routes/public/speach/${data.id}.mp3`, async (err) => {
                    if(err) {
                        console.error(err);
                        return;
                    }
    
                    await cacheClient.sRem(`${channelId}:speach`, data.id);
    
                    let messages = await cacheClient.sCard(`${channelId}:speach`);
                    if(messages > 0) {
                        let messageQueue = await cacheClient.sMembers(`${channelId}:speach`);
                        let id = messageQueue[0];
                        socket.emit('speach', { id: id });
                    }
                });
            });
        })
    
        //? Overlay triggers
        io.of(/^\/overlays\/triggers\/\w+$/).on('connection', async (socket) => {
            const cacheClient = await getDragonflyClient('Websocket');
            const channelId = socket.nsp.name.split('/')[3];
    
            let account = await TwitchStreamers.getTwitchAccountById(channelId);
            if(!account) {
                socket.emit('error', {
                    message: 'Account not found',
                    status: 404
                });
                return;
            }
    
            console.log(`${channelId} (${account.name}) connected to triggers`);
    
            socket.on('disconnect', () => {
                console.log(`${channelId} (${account.name}) disconnected from triggers`);
            });
        });
    
        //? Overlay Furry
        io.of(/^\/overlays\/furry\/\w+$/).on('connection', async (socket) => {
            const cacheClient = await getDragonflyClient('Websocket');
            const channelId = socket.nsp.name.split('/')[3];
    
            let account = await TwitchStreamers.getTwitchAccountById(channelId);
            if(!account) {
                socket.emit('error', {
                    message: 'Account not found',
                    status: 404
                });
                return;
            }
    
            console.log(`${channelId} (${account.name}) connected to furry`);
    
            socket.on('disconnect', () => {
                console.log(`${channelId} (${account.name}) disconnected from furry`);
            });
        });
    
        //* TODO: Add clip endpoint

        //? Clip Namespace
        io.of(/^\/clip\/\w+$/).on('connection', async (socket) => {
            const cacheClient = await getDragonflyClient('Websocket');
            const channelID = socket.nsp.name.split('/')[2];

            // Validate channel
            const account = await TwitchStreamers.getTwitchAccountById(channelID);
            if(!account) {
                socket.emit('error', {
                    message: 'Account not found',
                    status: 404
                });
                return;
            }

            // Cleanup old processing flag
            try {
                await cacheClient.del(`twitch:${channelID}:clip:processing`);
            } catch (error) {
                console.error(`Error deleting old processing flag for ${channelID}:`, error);
            }

            // Set connection flag
            await cacheClient.set(`twitch:${channelID}:clips:connected`, "true");
            console.log(`${channelID} (${account.name}) connected to clip`);

            // Subscribe to clip requests for this channel
            await clipQueueHandler.subscribeToChannel(channelID);

            // Handle clip-ended event from OBS
            socket.on('clip-ended', async () => {
                console.log(`Clip ended for channel ${channelID}`);

                // Clear processing flag
                await cacheClient.del(`twitch:${channelID}:clip:processing`);

                // Process next clip in queue
                await clipQueueHandler.processNextClip(channelID);
            });

            // Handle disconnect with 5s delay
            let disconnectTimeout: NodeJS.Timeout | null = null;
            socket.on('disconnect', () => {
                console.log(`${channelID} (${account.name}) disconnected from clip`);

                // Wait 5s for reconnect before deleting
                disconnectTimeout = setTimeout(async () => {
                    await cacheClient.del(`twitch:${channelID}:clips:connected`);
                    await cacheClient.del(`twitch:${channelID}:clips:timeouts:default`);
                    console.log(`${channelID} OBS connection fully removed`);
                }, 5000);
            });

            // Clear disconnect timeout if reconnected
            socket.on('connect', () => {
                if (disconnectTimeout) {
                    clearTimeout(disconnectTimeout);
                    disconnectTimeout = null;
                }
            });

            // Optional: Read timeout from query param
            const socketQuery = socket.handshake.query as Record<string, string>;
            const timeoutParam = socketQuery.timeout;
            if (timeoutParam && !isNaN(parseInt(timeoutParam))) {
                await cacheClient.set(`twitch:${channelID}:clips:timeouts:default`, timeoutParam);
                console.log(`Set clip timeout for channel ${channelID} to ${timeoutParam}s`);
            }
        });
    
        //? Sumimetro Endpoint
        io.of(/^\/sumimetro\/\w+\/\w+$/).on('connection', async (socket) => {
            const cacheClient = await getDragonflyClient('Websocket');
            const type = socket.nsp.name.split('/')[2];
            const channelId = socket.nsp.name.split('/')[3];
    
            let account = await TwitchStreamers.getTwitchAccountById(channelId);
            if(!account) {
                socket.emit('error', {
                    message: 'Account not found',
                    status: 404
                });
                return;
            }
    
            console.log(`${channelId} (${account.name}) connected to sumimetro ${type}`);
    
            if(type == 'sumiso') {
                let value = await cacheClient.hGet(`${channelId}:sumimetro:submissive`, 'value');
                let username = await cacheClient.hGet(`${channelId}:sumimetro:submissive`, 'user');
                if(value !== null && username !== null) {
                    socket.emit('sumimetro', { username, value });
                }
            }
    
            if(type == 'dominante') {
                let value = await cacheClient.hGet(`${channelId}:sumimetro:dominant`, 'value');
                let username = await cacheClient.hGet(`${channelId}:sumimetro:dominant`, 'user');
                if(value !== null && username !== null) {
                    socket.emit('sumimetro', { username, value });
                }
            }
    
            socket.on('disconnect', () => {
                console.log(`${channelId} (${account.name}) disconnected from sumimetro ${type}`);
            });
        });
    
        //* TODO: Add site analytics endpoint
    
        io.on('error', (error) => {
            console.error('Websocket error:', error);
        });
    
        return server;
    } catch (error) {
        console.error('Error on websocket:', error);
        return null;
    } finally {
        console.log('Websocket closed');
    }
}

export function getIO(): Server | null {
    return io;
}

export default websocket;