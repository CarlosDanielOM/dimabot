import { Server } from "socket.io";
import http from "http";
import fs from "fs";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";

import TwitchStreamers from "../classes/twitch_streamers.class.js";

let io = null;

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

export default websocket;