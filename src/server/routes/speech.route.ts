import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';

import TwitchStreamers from '../../classes/twitch_streamers.class.js';
import { ttsQueueHandler, type TtsRequestPayload } from '../../handlers/tts_queue.handler.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import type { AuthRequest } from '../../middleware/types.js';
import { AdminSchema } from '../../schemas/admin.schema.js';
import {
    getChannelTtsSettings,
    normalizeChannelTtsSettings,
    upsertChannelTtsSettings,
    type ChannelTtsSettingsData,
    type TtsLanguage,
    type TtsMode
} from '../../schemas/channel_tts_settings.schema.js';
import { getDirname } from '../../utils/pollyfills.js';
import { normalizeTtsMessage } from '../../utils/tts/normalize_tts_message.util.js';

const __dirname = getDirname(import.meta.url);
const router = express.Router();
const publicDir = path.join(__dirname, 'public');

interface SpeechPostBody {
    mode?: TtsMode;
    text?: string;
    language?: TtsLanguage;
    cloneName?: string;
    requestedBy?: {
        userID?: string;
        userLogin?: string;
        userName?: string;
        userLevel?: number;
    };
    meta?: {
        source?: 'chat-command' | 'ast' | 'redemption';
        originalText?: string;
        skipEmotes?: boolean;
        stripLinks?: boolean;
    };
}

type SettingsAccessRole = 'owner' | 'admin' | 'none';

function normalizeRouteParam(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] || '' : value || '';
}

function resolveVoice(settings: ChannelTtsSettingsData, mode: TtsMode, language: TtsLanguage): string | null {
    if (mode === 'ai') {
        return settings.voices.aiDefault;
    }

    if (mode === 'clone') {
        return null;
    }

    return language === 'en' ? settings.voices.en : settings.voices.es;
}

function canUseMode(mode: TtsMode, planTier: string | undefined): boolean {
    if (mode === 'speak') {
        return true;
    }

    if (mode === 'ai') {
        return planTier === 'premium' || planTier === 'pro';
    }

    return planTier === 'pro';
}

function getModeUnavailableMessage(mode: TtsMode): string {
    if (mode === 'ai') {
        return 'AI TTS voices are not available yet';
    }

    if (mode === 'clone') {
        return 'Voice cloning is not available yet';
    }

    return 'Unsupported TTS mode';
}

async function getSettingsAccess(requesterID: string, channelID: string): Promise<SettingsAccessRole> {
    if (requesterID === channelID) {
        return 'owner';
    }

    const admin = await AdminSchema.findOne({
        channelID,
        adminID: requesterID,
        actived: true,
        permissions: { $in: ['*', 'settings:view'] }
    }).lean();

    return admin ? 'admin' : 'none';
}

router.get('/settings/:channelID', authMiddleware as any, async (req: AuthRequest, res: Response) => {
    try {
        const channelID = normalizeRouteParam(req.params.channelID);
        const requesterID = req.user?.id;

        if (!requesterID) {
            return res.status(401).json({
                error: true,
                message: 'Authentication required',
                status: 401
            });
        }

        const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
        if (!streamer) {
            return res.status(404).json({
                error: true,
                message: 'Streamer not found',
                status: 404
            });
        }

        const role = await getSettingsAccess(requesterID, channelID);
        if (role === 'none') {
            return res.status(403).json({
                error: true,
                message: 'You do not have permission to view TTS settings',
                status: 403
            });
        }

        const settings = await getChannelTtsSettings(channelID, streamer.name);
        return res.status(200).json({
            error: false,
            message: 'TTS settings fetched successfully',
            status: 200,
            data: {
                role,
                settings
            }
        });
    } catch (error) {
        console.error('Error in GET /speech/settings/:channelID:', {
            channelID: req.params.channelID,
            requesterID: req.user?.id,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.put('/settings/:channelID', authMiddleware as any, async (req: AuthRequest, res: Response) => {
    try {
        const channelID = normalizeRouteParam(req.params.channelID);
        const requesterID = req.user?.id;

        if (!requesterID) {
            return res.status(401).json({
                error: true,
                message: 'Authentication required',
                status: 401
            });
        }

        const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
        if (!streamer) {
            return res.status(404).json({
                error: true,
                message: 'Streamer not found',
                status: 404
            });
        }

        const role = await getSettingsAccess(requesterID, channelID);
        if (role !== 'owner') {
            return res.status(403).json({
                error: true,
                message: 'Only the channel owner can update TTS settings',
                status: 403
            });
        }

        const nextSettings = normalizeChannelTtsSettings(req.body as Partial<ChannelTtsSettingsData>, channelID, streamer.name);
        const savedSettings = await upsertChannelTtsSettings(channelID, nextSettings, streamer.name);

        return res.status(200).json({
            error: false,
            message: 'TTS settings updated successfully',
            status: 200,
            data: {
                role,
                settings: savedSettings
            }
        });
    } catch (error) {
        console.error('Error in PUT /speech/settings/:channelID:', {
            channelID: req.params.channelID,
            requesterID: req.user?.id,
            body: req.body,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.get('/audio/:channelID/:speechID', async (req: Request, res: Response) => {
    try {
        const channelID = normalizeRouteParam(req.params.channelID);
        const speechID = normalizeRouteParam(req.params.speechID);
        const audioPath = path.join(publicDir, 'speech', channelID, `${speechID}.wav`);

        if (!fs.existsSync(audioPath)) {
            return res.status(404).json({
                error: true,
                message: 'Speech audio not found',
                status: 404
            });
        }

        res.type('audio/wav');
        return res.sendFile(audioPath);
    } catch (error) {
        console.error('Error in GET /speech/audio/:channelID/:speechID:', {
            channelID: req.params.channelID,
            speechID: req.params.speechID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.get('/:channelID', async (req: Request, res: Response) => {
    try {
        return res.status(200).sendFile(path.join(publicDir, 'speech.html'));
    } catch (error) {
        console.error('Error in GET /speech/:channelID:', {
            channelID: req.params.channelID,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return res.status(500).json({
            error: true,
            message: 'Error loading speech overlay',
            status: 500
        });
    }
});

router.post('/:channelID', async (req: Request, res: Response) => {
    try {
        const channelID = normalizeRouteParam(req.params.channelID);
        const body = req.body as SpeechPostBody;
        const mode = body.mode || 'speak';

        const streamer = await TwitchStreamers.getTwitchAccountById(channelID);
        if (!streamer) {
            return res.status(404).json({
                error: true,
                message: 'Streamer not found',
                status: 404
            });
        }

        const settings = await getChannelTtsSettings(channelID, streamer.name);
        if (!settings.enabled) {
            return res.status(403).json({
                error: true,
                message: 'TTS is disabled for this channel',
                status: 403
            });
        }

        if (!canUseMode(mode, streamer.plan_tier)) {
            return res.status(403).json({
                error: true,
                message: 'Your plan does not include this TTS mode',
                status: 403
            });
        }

        if (mode !== 'speak') {
            return res.status(501).json({
                error: true,
                message: getModeUnavailableMessage(mode),
                status: 501
            });
        }

        const normalizedText = normalizeTtsMessage(String(body.text || ''), {
            skipEmotes: false,
            stripLinks: settings.filters.stripLinks,
            normalizeWhitespace: settings.filters.normalizeWhitespace,
            maxLength: settings.filters.maxLength,
            emoteNames: []
        });

        if (normalizedText.error) {
            return res.status(400).json({
                error: true,
                message: normalizedText.message,
                status: 400
            });
        }

        const language = body.language === 'en' ? 'en' : settings.defaultLanguage;
        const voice = resolveVoice(settings, mode, language);
        if (!voice) {
            return res.status(400).json({
                error: true,
                message: 'No voice is configured for this request',
                status: 400
            });
        }

        const requestPayload: TtsRequestPayload = {
            channelID,
            source: body.meta?.source || 'chat-command',
            mode,
            text: normalizedText.text,
            language,
            voice,
            cloneName: body.cloneName,
            requestedBy: body.requestedBy,
            meta: {
                originalText: body.meta?.originalText || normalizedText.originalText,
                skipEmotes: body.meta?.skipEmotes,
                stripLinks: body.meta?.stripLinks
            }
        };

        const result = await ttsQueueHandler.queueRequest(requestPayload, settings);
        return res.status(result.status).json({
            error: result.error,
            message: result.message,
            status: result.status,
            data: result.data
        });
    } catch (error) {
        console.error('Error in POST /speech/:channelID:', {
            channelID: req.params.channelID,
            body: req.body,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

export const speechRoute = router;
