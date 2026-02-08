import { Server as SocketIOServer } from "socket.io";
import type { Socket as SocketIOSocket } from "socket.io";
import http, { type Server as HttpServer } from "http";
import fs from "fs";
import path from "path";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";

import TwitchStreamers from "../classes/twitch_streamers.class.js";
import { clipQueueHandler } from "../handlers/clip_queue.handler.js";
import { getDirname } from "../utils/pollyfills.js";
import { getSiteAnalytics } from "../utils/siteanalytics.js";

const __dirname = getDirname(import.meta.url);

let io: SocketIOServer | null = null;
let cacheClient: Awaited<ReturnType<typeof getDragonflyClient>> | null = null;
const disconnectTimeouts = new Map<string, NodeJS.Timeout>();

export const websocket = async (app: any): Promise<HttpServer | null> => {
    try {
        cacheClient = await getDragonflyClient('Websocket');
        let server = http.createServer(app);
        io = new SocketIOServer(server, {
            connectionStateRecovery: {}
        });

        //? Clip Namespace with heartbeat mechanism
        io.of(/^\/clip\/\w+$/).on('connection', async (socket) => {
            const channelID = socket.nsp.name.split('/')[2];

            const account = await TwitchStreamers.getTwitchAccountById(channelID);
            if(!account) {
                socket.emit('error', {
                    message: 'Account not found',
                    status: 404
                });
                return;
            }

            // Clear any pending disconnect timeout for this channel
            const existingTimeout = disconnectTimeouts.get(channelID);
            if (existingTimeout) {
                clearTimeout(existingTimeout);
                disconnectTimeouts.delete(channelID);
                console.log(`${channelID} reconnected, cleared disconnect timeout`);
            }

            // Cleanup old processing flag
            try {
                await cacheClient!.del(`twitch:${channelID}:clip:processing`);
            } catch (error) {
                console.error(`Error deleting old processing flag for ${channelID}:`, error);
            }

            // Set connection flag and initial heartbeat timestamp
            await cacheClient!.set(`twitch:${channelID}:clips:connected`, "true");
            await cacheClient!.set(`twitch:${channelID}:clips:last_activity`, Date.now());
            console.log(`${channelID} (${account.name}) connected to clip`);

            // Subscribe to clip requests for this channel
            await clipQueueHandler.subscribeToChannel(channelID);

            // Check if there's already a queue waiting and start processing
            const isProcessing = await cacheClient!.exists(`twitch:${channelID}:clip:processing`);
            if (!isProcessing) {
                const queueLength = await cacheClient!.zCard(`twitch:${channelID}:clips:queue`);
                if (queueLength > 0) {
                    console.log(`Found ${queueLength} clips in queue for ${channelID}, starting processing`);
                    await clipQueueHandler.processNextClip(channelID);
                }
            }

            // Handle clip-ended event from OBS
            socket.on('clip-ended', async (data: { channelID: string, clipID?: string }) => {
                // Use the handler's cleanup method which also clears timeouts
                await clipQueueHandler.handleClipEnded(data.channelID, data.clipID);
            });

            // Handle heartbeat/ping from OBS
            socket.on('ping', async () => {
                await cacheClient!.set(`twitch:${channelID}:clips:last_activity`, Date.now());
            });

            // Handle disconnect with 30s delay
            socket.on('disconnect', () => {
                console.log(`${channelID} (${account.name}) disconnected from clip`);

                const timeout = setTimeout(async () => {
                    // Check if socket is still disconnected before cleaning up
                    const namespace = io?.of(`/clip/${channelID}`);
                    if (namespace) {
                        const sockets = await namespace.fetchSockets();
                        if (sockets.length === 0) {
                            await cacheClient!.del(`twitch:${channelID}:clips:connected`);
                            await cacheClient!.del(`twitch:${channelID}:clips:timeouts:default`);
                            console.log(`${channelID} OBS connection removed (30s timeout)`);
                        } else {
                            console.log(`${channelID} has ${sockets.length} active socket(s), keeping connection flag`);
                        }
                    }
                    disconnectTimeouts.delete(channelID);
                }, 30000);

                disconnectTimeouts.set(channelID, timeout);
            });

            // Optional: Read timeout from query param
            const socketQuery = socket.handshake.query as Record<string, string>;
            const timeoutParam = socketQuery.timeout;
            if (timeoutParam && !isNaN(parseInt(timeoutParam))) {
                await cacheClient!.set(`twitch:${channelID}:clips:timeouts:default`, timeoutParam);
                console.log(`Set clip timeout for channel ${channelID} to ${timeoutParam}s`);
            }
        });

        //? Site Global Data Analytics
        io.of(/^\/site\/analytics\/[\w-]+$/).on('connection', async (socket) => {
            const type = socket.nsp.name.split('/')[3];

            if (type === 'live-channels') {
                const liveChannels = await getSiteAnalytics('live');
                socket.emit('live-channels', liveChannels);
            }

            if (type === 'active-channels') {
                const activeChannels = await getSiteAnalytics('active');
                socket.emit('active-channels', activeChannels);
            }

            if (type === 'registered-channels') {
                const registeredChannels = await getSiteAnalytics('registered');
                socket.emit('registered-channels', registeredChannels);
            }

            socket.on('disconnect', () => {
                // No cleanup needed
            });
        });

        // Setup stale connection cleanup job - only clean up truly stale connections
        setInterval(async () => {
            if (!io || !cacheClient) return;

            try {
                const allChannels = await TwitchStreamers.getTwitchAccountsFromCache();
                if (!allChannels || allChannels.length === 0) return;

                for (const channel of allChannels) {
                    const namespace = io.of(`/clip/${channel.id}`);
                    const sockets = await namespace.fetchSockets();
                    
                    // If there are active sockets, skip cleanup
                    if (sockets.length > 0) {
                        continue;
                    }

                    // Check heartbeat timestamp - only delete if no heartbeat for 60+ seconds
                    const lastActivity = await cacheClient.get(`twitch:${channel.id}:clips:last_activity`);
                    const now = Date.now();
                    const timeSinceActivity = lastActivity ? now - parseInt(lastActivity) : Infinity;

                    if (timeSinceActivity > 60000) {
                        await cacheClient.del(`twitch:${channel.id}:clips:connected`);
                        await cacheClient.del(`twitch:${channel.id}:clips:processing`);
                        // console.log(`${channel.id} (${channel.name}) marked as inactive (no heartbeat for ${Math.round(timeSinceActivity / 1000)}s)`);
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

export function getIO(): SocketIOServer | null {
    return io;
}

export default websocket;
