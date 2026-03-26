import type { TtsLanguage, TtsMode } from '../../../schemas/channel_tts_settings.schema.js';

export interface TtsSynthesisRequest {
    channelID: string;
    speechID: string;
    mode: TtsMode;
    text: string;
    language: TtsLanguage;
    voice: string;
    outputPath: string;
    cloneName?: string;
}

export interface TtsSynthesisResult {
    error: boolean;
    message: string;
    outputPath?: string;
    publicPath?: string;
    mimeType?: 'audio/wav';
}

export interface TtsProvider {
    name: string;
    synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult>;
}
