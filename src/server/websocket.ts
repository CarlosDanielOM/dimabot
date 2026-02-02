import { Server } from "socket.io";
import type { Socket as SocketIOSocket } from "socket.io";
import http from "http";
import fs from "fs";
import path from "path";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";

import TwitchStreamers from "../classes/twitch_streamers.class.js";
import { clipQueueHandler } from "./clip_queue_handler.js";
import { getDirname } from "../utils/pollyfills.js";

const __dirname = getDirname(import.meta.url);

let io: Server | null = null;

export const websocket = async (app: any): Promise<Server | null> => {
    try {
        let server = http.createServer(app);
        io = new Server(server, {
            connectionStateRecovery: {}
        });

        //? Clip Namespace with heartbeat mechanism
        io.of(/^\/clip\/\w+$/).on('connection', async (socket) => {
            const cacheClient = await getDragonflyClient('Websocket');
            const channelID = socket.nsp.name.split('/')[2];

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
                console.log('Clip ended for channel \${channelID}');

                // Clear processing flag
                await cacheClient.del('twitch:\${channelID}:clip:processing');

                // Process next clip in queue
                await clipQueueHandler.processNextClip(channelID);
            });

            // Handle heartbeat/ping from OBS
            socket.on('ping', async () => {
                await cacheClient.set(`twitch:${channelID}:clips:last_activity`, Date.now());
            });

            // Handle disconnect with 30s delay
            let disconnectTimeout: NodeJS.Timeout | null = null;
            socket.on('disconnect', () => {
                console.log('\${channelID} (\${account.name}) disconnected from clip');

                disconnectTimeout = setTimeout(async () => {
                    await cacheClient.del('twitch:\${channelID}:clips:connected');
                    await cacheClient.del('twitch:\${channelID}:clips:timeouts:default');
                    console.log('\${channelID} OBS connection removed (30s timeout)');
                }, 30000);
            });

            // Clear disconnect timeout if reconnected
            socket.on('connect', () => {
                if (disconnectTimeout) {
                    clearTimeout(disconnectTimeout);
                    disconnectTimeout = null;
                    console.log('\${channelID} OBS reconnected within timeout, clearing disconnect timer');
                }
            });

            // Optional: Read timeout from query param
            const socketQuery = socket.handshake.query as Record<string, string>;
            const timeoutParam = socketQuery.timeout;
            if (timeoutParam && !isNaN(parseInt(timeoutParam))) {
                await cacheClient.set('twitch:\${channelID}:clips:timeouts:default', timeoutParam);
                console.log('Set clip timeout for channel \${channelID} to \${timeoutParam}s');
            }
        });

        // Setup stale connection cleanup job
        setInterval(async () => {
            try {
                const allChannels = await TwitchStreamers.getTwitchAccountsFromDB();
                if (allChannels && allChannels.length > 0) {
                    for (const channel of allChannels) {
                        const lastActivity = await cacheClient.get(`twitch:${channel.id}:clips:last_activity`);
                        
                        if (lastActivity) {
                            const lastActivityTime = parseInt(lastActivity);
                            const inactiveTime = Date.now() - lastActivityTime;
                            
                            if (inactiveTime > 60000) {
                                await cacheClient.del(`twitch:${channel.id}:clips:connected`);
                                await cacheClient.del(`twitch:${channel.id}:clips:processing`);
                                console.log(`${channel.id} (${channel.name}) marked as inactive (no heartbeat for 60s)`);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error in stale connection cleanup:', {
                    error: error instanceof Error ? error.message : String(error),
                    timestamp: new Date().toISOString()
                });
            }
        }, 30000); // Run every 30 seconds

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
