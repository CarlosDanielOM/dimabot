import type { RedisClientType } from 'redis';
import fs from 'fs/promises';
import path from 'path';

import { getDragonflyClient } from '../utils/databases/dragonfly.database.js';
import type { ChannelTtsSettingsData, TtsLanguage, TtsMode } from '../schemas/channel_tts_settings.schema.js';
import { generateSpeechID } from '../utils/tts/generate_speech_id.util.js';
import { getIO } from '../server/websocket.js';
import { piperTtsService, PIPER_PUBLIC_SPEECH_DIR } from '../server/services/tts/piper_tts.service.js';

export interface TtsRequestPayload {
    channelID: string;
    source: 'chat-command' | 'ast' | 'redemption';
    mode: TtsMode;
    text: string;
    language: TtsLanguage;
    voice: string;
    cloneName?: string;
    requestedBy?: {
        userID?: string;
        userLogin?: string;
        userName?: string;
        userLevel?: number;
    };
    meta?: {
        originalText?: string;
        skipEmotes?: boolean;
        stripLinks?: boolean;
    };
}

export interface TtsQueueItem extends TtsRequestPayload {
    speechID: string;
    timestamp: number;
}

export interface QueueTtsResponse {
    error: boolean;
    message: string;
    status: number;
    data?: {
        speechID: string;
        queueLength: number;
        mode: TtsMode;
    };
}

class TtsQueueHandler {
    private cache: RedisClientType | null = null;
    private initialized = false;
    private processingChannels = new Set<string>();
    private currentTimeouts = new Map<string, NodeJS.Timeout>();
    private currentFiles = new Map<string, string>();
    private fileCleanupTimeouts = new Map<string, NodeJS.Timeout>();

    async init(): Promise<void> {
        if (this.initialized) {
            return;
        }

        this.cache = await getDragonflyClient('TtsQueueHandler:init');
        this.initialized = true;
    }

    async isOverlayConnected(channelID: string): Promise<boolean> {
        if (!this.cache) {
            await this.init();
        }

        const connected = await this.cache!.exists(`twitch:${channelID}:tts:connected`);
        return connected === 1;
    }

    async queueRequest(
        payload: TtsRequestPayload,
        settings: ChannelTtsSettingsData
    ): Promise<QueueTtsResponse> {
        if (!this.cache) {
            await this.init();
        }

        const connected = await this.isOverlayConnected(payload.channelID);
        if (!connected) {
            return {
                error: true,
                message: 'Speech overlay is not connected. Open the speech URL first and try again.',
                status: 409
            };
        }

        const queueLength = await this.cache!.zCard(`twitch:${payload.channelID}:tts:queue`);
        const isProcessing = await this.cache!.exists(`twitch:${payload.channelID}:tts:processing`);
        const totalPending = queueLength + (isProcessing ? 1 : 0);

        if (totalPending >= settings.queue.maxItems) {
            return {
                error: true,
                message: 'TTS queue is full for this channel',
                status: 429
            };
        }

        const speechID = generateSpeechID();
        const queueItem: TtsQueueItem = {
            ...payload,
            speechID,
            timestamp: Date.now()
        };

        await this.cache!.set(`twitch:${payload.channelID}:tts:queue:data:${speechID}`, JSON.stringify(queueItem));
        await this.cache!.zAdd(`twitch:${payload.channelID}:tts:queue`, {
            score: queueItem.timestamp,
            value: speechID
        });

        if (!isProcessing) {
            await this.cache!.set(`twitch:${payload.channelID}:tts:processing`, 'pending');
            void this.processNext(payload.channelID);
        }

        return {
            error: false,
            message: 'TTS queued successfully',
            status: 200,
            data: {
                speechID,
                queueLength: totalPending + 1,
                mode: queueItem.mode
            }
        };
    }

    async processNext(channelID: string): Promise<void> {
        if (!this.cache) {
            await this.init();
        }

        if (this.processingChannels.has(channelID)) {
            return;
        }

        const next = await this.cache!.zPopMin(`twitch:${channelID}:tts:queue`);
        if (!next) {
            const processingKey = await this.cache!.get(`twitch:${channelID}:tts:processing`);
            if (processingKey === 'pending') {
                await this.cache!.del(`twitch:${channelID}:tts:processing`);
            }
            return;
        }

        const speechID = next.value;
        if (!speechID) {
            return;
        }

        const rawData = await this.cache!.get(`twitch:${channelID}:tts:queue:data:${speechID}`);
        if (!rawData) {
            await this.cache!.del(`twitch:${channelID}:tts:processing`);
            void this.processNext(channelID);
            return;
        }

        let queueItem: TtsQueueItem;
        try {
            queueItem = JSON.parse(rawData) as TtsQueueItem;
        } catch {
            await this.cache!.del(`twitch:${channelID}:tts:queue:data:${speechID}`);
            await this.cache!.del(`twitch:${channelID}:tts:processing`);
            void this.processNext(channelID);
            return;
        }

        this.processingChannels.add(channelID);
        await this.cache!.set(`twitch:${channelID}:tts:processing`, speechID);

        const synthesisResult = await piperTtsService.synthesize({
            channelID,
            speechID,
            mode: queueItem.mode,
            text: queueItem.text,
            language: queueItem.language,
            voice: queueItem.voice,
            cloneName: queueItem.cloneName,
            outputPath: ''
        });

        if (synthesisResult.error || !synthesisResult.outputPath || !synthesisResult.publicPath) {
            console.error('TTS synthesis failed:', {
                channelID,
                speechID,
                error: synthesisResult.message,
                timestamp: new Date().toISOString()
            });

            await this.cleanupSpeech(channelID, speechID);
            void this.processNext(channelID);
            return;
        }

        this.currentFiles.set(`${channelID}:${speechID}`, synthesisResult.outputPath);

        const io = getIO();
        if (!io) {
            console.error('Socket.IO not initialized for TTS playback');
            await this.cleanupSpeech(channelID, speechID);
            void this.processNext(channelID);
            return;
        }

        const timeout = setTimeout(() => {
            void this.handleSpeechEnded(channelID, speechID);
        }, 30000);

        this.currentTimeouts.set(`${channelID}:${speechID}`, timeout);

        io.of(`/speech/${channelID}`).emit('speech', {
            speechID,
            audioUrl: synthesisResult.publicPath,
            mimeType: synthesisResult.mimeType || 'audio/wav',
            mode: queueItem.mode,
            text: queueItem.text
        });
    }

    async handleSpeechEnded(channelID: string, speechID?: string): Promise<void> {
        if (!this.cache) {
            await this.init();
        }

        const currentSpeechID = speechID || await this.cache!.get(`twitch:${channelID}:tts:processing`) || undefined;
        if (!currentSpeechID) {
            this.processingChannels.delete(channelID);
            await this.cache!.del(`twitch:${channelID}:tts:processing`);
            void this.processNext(channelID);
            return;
        }

        await this.cleanupSpeech(channelID, currentSpeechID);
        void this.processNext(channelID);
    }

    async cleanupSpeech(channelID: string, speechID: string): Promise<void> {
        if (!this.cache) {
            await this.init();
        }

        const timeoutKey = `${channelID}:${speechID}`;
        const timeout = this.currentTimeouts.get(timeoutKey);
        if (timeout) {
            clearTimeout(timeout);
            this.currentTimeouts.delete(timeoutKey);
        }

        const outputPath = this.currentFiles.get(timeoutKey);
        if (outputPath) {
            this.scheduleFileCleanup(timeoutKey, outputPath);
        }

        await this.cache!.del(`twitch:${channelID}:tts:processing`);
        await this.cache!.del(`twitch:${channelID}:tts:queue:data:${speechID}`);
        this.processingChannels.delete(channelID);
    }

    async cleanupChannel(channelID: string): Promise<void> {
        if (!this.cache) {
            await this.init();
        }

        const queueKeys = await this.cache!.keys(`twitch:${channelID}:tts:queue:data:*`);
        const currentSpeechID = await this.cache!.get(`twitch:${channelID}:tts:processing`);

        for (const key of queueKeys) {
            await this.cache!.del(key);
        }

        if (currentSpeechID) {
            await this.cleanupSpeech(channelID, currentSpeechID);
        }

        await this.cache!.del(`twitch:${channelID}:tts:queue`);
        await this.cache!.del(`twitch:${channelID}:tts:connected`);
        await this.cache!.del(`twitch:${channelID}:tts:processing`);

        const channelDir = path.join(PIPER_PUBLIC_SPEECH_DIR, channelID);
        for (const [fileKey, filePath] of this.currentFiles.entries()) {
            if (!fileKey.startsWith(`${channelID}:`)) {
                continue;
            }

            const cleanupTimeout = this.fileCleanupTimeouts.get(fileKey);
            if (cleanupTimeout) {
                clearTimeout(cleanupTimeout);
                this.fileCleanupTimeouts.delete(fileKey);
            }

            try {
                await fs.unlink(filePath);
            } catch {
                // Ignore missing temp files during cleanup.
            }

            this.currentFiles.delete(fileKey);
        }

        try {
            await fs.rm(channelDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup failures on missing directories.
        }

        this.processingChannels.delete(channelID);
    }

    private scheduleFileCleanup(fileKey: string, outputPath: string): void {
        const existingTimeout = this.fileCleanupTimeouts.get(fileKey);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        const cleanupTimeout = setTimeout(() => {
            void fs.unlink(outputPath).catch(() => {
                // Ignore missing temp files during delayed cleanup.
            }).finally(() => {
                this.currentFiles.delete(fileKey);
                this.fileCleanupTimeouts.delete(fileKey);
            });
        }, 120000);

        this.fileCleanupTimeouts.set(fileKey, cleanupTimeout);
    }
}

const ttsQueueHandler = new TtsQueueHandler();

export { ttsQueueHandler };
