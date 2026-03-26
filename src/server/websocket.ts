import { Server as SocketIOServer } from "socket.io";
import http, { type Server as HttpServer } from "http";
import { getDragonflyClient } from "../utils/databases/dragonfly.database.js";

import TwitchStreamers from "../classes/twitch_streamers.class.js";
import { clipQueueHandler } from "../handlers/clip_queue.handler.js";
import { ttsQueueHandler } from "../handlers/tts_queue.handler.js";
import { getCachedLiveStatus, getSiteAnalytics } from "../utils/siteanalytics.js";
import { getLiveSessionMetrics } from "../utils/stream_analytics.js";

const DASHBOARD_LIVE_STATUS_INTERVAL_MS = Math.max(1000, Number(process.env.DASHBOARD_LIVE_STATUS_INTERVAL_MS || 1000));

let io: SocketIOServer | null = null;
let cacheClient: Awaited<ReturnType<typeof getDragonflyClient>> | null = null;
const disconnectTimeouts = new Map<string, NodeJS.Timeout>();

async function getChannelLiveStatus(channelID: string): Promise<{ isLive: boolean; currentViewers: number }> {
    try {
        const live = await getCachedLiveStatus(channelID);
        return {
            isLive: live.isLive,
            currentViewers: Number(live.stream?.viewer_count || 0)
        };
    } catch (error) {
        console.error(`Error fetching live status for ${channelID}:`, error);
        return {
            isLive: false,
            currentViewers: 0
        };
    }
}

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

        //? Dashboard Namespace
        io.of(/^\/dashboard\/\w+$/).on('connection', async (socket) => {
            const channelID = socket.nsp.name.split('/')[2];

            const account = await TwitchStreamers.getTwitchAccountById(channelID);
            if (!account) {
                socket.emit('error', {
                    message: 'Account not found',
                    status: 404
                });
                return;
            }

            console.log(`${account.name} (${channelID}) connected to dashboard`);

            const initialLiveStatus = await getChannelLiveStatus(channelID);
            const initialLiveSession = await getLiveSessionMetrics(channelID, {
                currentViewers: initialLiveStatus.currentViewers
            });
            socket.emit('dashboard-snapshot', {
                channelID,
                connectedAt: new Date().toISOString(),
                isLive: initialLiveStatus.isLive,
                liveSession: initialLiveSession
            });

            const liveStatusInterval = setInterval(async () => {
                const liveStatus = await getChannelLiveStatus(channelID);
                const liveSession = await getLiveSessionMetrics(channelID, {
                    currentViewers: liveStatus.currentViewers
                });
                socket.emit('stream-status', {
                    channelID,
                    isLive: liveStatus.isLive,
                    checkedAt: new Date().toISOString(),
                    liveSession
                });
            }, DASHBOARD_LIVE_STATUS_INTERVAL_MS);

            socket.on('dashboard-ping', () => {
                socket.emit('dashboard-pong', {
                    channelID,
                    timestamp: new Date().toISOString()
                });
            });

            socket.on('disconnect', () => {
                clearInterval(liveStatusInterval);
                console.log(`${account.name} (${channelID}) disconnected from dashboard`);
            });
        });

        //? Overlay Triggers
        io.of(/^\/overlays\/triggers\/\w+$/).on('connection', async (socket) => {
            const channelID = socket.nsp.name.split('/')[3];
            const timeoutKey = `triggers:${channelID}`;

            const account = await TwitchStreamers.getTwitchAccountById(channelID);
            if (!account) {
                socket.emit('error', {
                    message: 'Account not found',
                    status: 404
                });
                return;
            }

            const existingTimeout = disconnectTimeouts.get(timeoutKey);
            if (existingTimeout) {
                clearTimeout(existingTimeout);
                disconnectTimeouts.delete(timeoutKey);
                console.log(`${channelID} reconnected to triggers, cleared disconnect timeout`);
            }

            await cacheClient!.set(`twitch:${channelID}:triggers:connected`, 'true');
            await cacheClient!.set(`twitch:${channelID}:triggers:last_activity`, Date.now());

            console.log(`${account.name} (${channelID}) connected to triggers`);

            socket.on('ping', async () => {
                await cacheClient!.set(`twitch:${channelID}:triggers:last_activity`, Date.now());
            });

            socket.on('disconnect', () => {
                console.log(`${account.name} (${channelID}) disconnected from triggers`);

                const timeout = setTimeout(async () => {
                    const namespace = io?.of(`/overlays/triggers/${channelID}`);

                    if (namespace) {
                        const sockets = await namespace.fetchSockets();

                        if (sockets.length === 0) {
                            await cacheClient!.del(`twitch:${channelID}:triggers:connected`);
                            console.log(`${channelID} trigger connection removed (10s timeout)`);
                        } else {
                            console.log(`${channelID} has ${sockets.length} active trigger socket(s), keeping connection flag`);
                        }
                    }
                    disconnectTimeouts.delete(timeoutKey);
                }, 10000);

                disconnectTimeouts.set(timeoutKey, timeout);
            });
        });

        //? Speech Namespace
        io.of(/^\/speech\/\w+$/).on('connection', async (socket) => {
            const channelID = socket.nsp.name.split('/')[2];

            const account = await TwitchStreamers.getTwitchAccountById(channelID);
            if (!account) {
                socket.emit('error', {
                    message: 'Account not found',
                    status: 404
                });
                return;
            }

            // Clear any pending disconnect timeout for this channel
            const existingTimeout = disconnectTimeouts.get(`speech:${channelID}`);
            if (existingTimeout) {
                clearTimeout(existingTimeout);
                disconnectTimeouts.delete(`speech:${channelID}`);
                console.log(`${channelID} reconnected to speech, cleared disconnect timeout`);
            }

            await cacheClient!.set(`twitch:${channelID}:tts:connected`, "true");
            console.log(`${account.name} (${channelID}) connected to speech`);

            const isProcessing = await cacheClient!.exists(`twitch:${channelID}:tts:processing`);
            if (!isProcessing) {
                const queueLength = await cacheClient!.zCard(`twitch:${channelID}:tts:queue`);
                if (queueLength > 0) {
                    void ttsQueueHandler.processNext(channelID);
                }
            }

            // Handle speech-ended event from overlay
            socket.on('speech-ended', async (data: { speechID?: string, channelID?: string }) => {
                await ttsQueueHandler.handleSpeechEnded(data.channelID || channelID, data.speechID);
            });

            // Handle disconnect with 5s delay
            socket.on('disconnect', () => {
                console.log(`${account.name} (${channelID}) disconnected from speech`);

                const timeout = setTimeout(async () => {
                    const namespace = io?.of(`/speech/${channelID}`);
                    if (namespace) {
                        const sockets = await namespace.fetchSockets();
                        if (sockets.length === 0) {
                            await cacheClient!.del(`twitch:${channelID}:tts:connected`);
                            console.log(`${channelID} speech connection removed (5s timeout)`);
                        } else {
                            console.log(`${channelID} has ${sockets.length} active speech socket(s), keeping connection flag`);
                        }
                    }
                    disconnectTimeouts.delete(`speech:${channelID}`);
                }, 5000);

                disconnectTimeouts.set(`speech:${channelID}`, timeout);
            });
        });

        // Setup stale connection cleanup job - only clean up truly stale connections
        setInterval(async () => {
            if (!io || !cacheClient) return;

            try {
                const allChannels = await TwitchStreamers.getTwitchAccountsFromCache();
                if (!allChannels || allChannels.length === 0) return;

                for (const channel of allChannels) {
                    // Check clip connections
                    const clipNamespace = io.of(`/clip/${channel.id}`);
                    const clipSockets = await clipNamespace.fetchSockets();

                    if (clipSockets.length === 0) {
                        // Check heartbeat timestamp - only delete if no heartbeat for 60+ seconds
                        const lastActivity = await cacheClient.get(`twitch:${channel.id}:clips:last_activity`);
                        const now = Date.now();
                        const timeSinceActivity = lastActivity ? now - parseInt(lastActivity) : Infinity;

                        if (timeSinceActivity > 60000) {
                            await cacheClient.del(`twitch:${channel.id}:clips:connected`);
                            await cacheClient.del(`twitch:${channel.id}:clips:processing`);
                            // console.log(`${channel.id} (${channel.name}) clip marked as inactive (no heartbeat for ${Math.round(timeSinceActivity / 1000)}s)`);
                        }
                    }

                    // Check speech connections (no heartbeat, just check connected flag)
                    const speechNamespace = io.of(`/speech/${channel.id}`);
                    const speechSockets = await speechNamespace.fetchSockets();

                    if (speechSockets.length === 0) {
                        const speechConnected = await cacheClient.exists(`twitch:${channel.id}:tts:connected`);
                        if (speechConnected) {
                            // Speech doesn't have heartbeat, so just check if flag exists with no active sockets
                            // Wait 60s before cleanup to allow for reconnection
                            const speechKey = `twitch:${channel.id}:tts:last_cleanup`;
                            const lastCleanup = await cacheClient.get(speechKey);

                            if (!lastCleanup) {
                                await cacheClient.set(speechKey, Date.now());
                            } else {
                                const timeSinceCleanup = Date.now() - parseInt(lastCleanup);
                                if (timeSinceCleanup > 60000) {
                                    await cacheClient.del(`twitch:${channel.id}:tts:connected`);
                                    await cacheClient.del(`twitch:${channel.id}:tts:processing`);
                                    await cacheClient.del(speechKey);
                                    // console.log(`${channel.id} (${channel.name}) speech marked as inactive (no connections)`);
                                }
                            }
                        }
                    }

                    // Check trigger connections (heartbeat based, like clips)
                    const triggerNamespace = io.of(`/overlays/triggers/${channel.id}`);
                    const triggerSockets = await triggerNamespace.fetchSockets();

                    if (triggerSockets.length === 0) {
                        const lastActivity = await cacheClient.get(`twitch:${channel.id}:triggers:last_activity`);
                        const now = Date.now();
                        const timeSinceActivity = lastActivity ? now - parseInt(lastActivity) : Infinity;

                        if (timeSinceActivity > 60000) {
                            await cacheClient.del(`twitch:${channel.id}:triggers:connected`);
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

export function getIO(): SocketIOServer | null {
    return io;
}

export default websocket;
