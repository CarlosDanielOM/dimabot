import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import { getDirname } from '../../../utils/pollyfills.js';
import type { TtsProvider, TtsSynthesisRequest, TtsSynthesisResult } from './tts_provider.interface.js';

const __dirname = getDirname(import.meta.url);
const DEFAULT_PUBLIC_DIR = path.resolve(__dirname, '../../routes/public/speech');

function getPiperPythonBin(): string {
    return process.env.PIPER_PYTHON_BIN || 'python3';
}

function getPiperDataDir(): string | null {
    const configured = process.env.PIPER_DATA_DIR;
    if (configured && configured.trim() !== '') {
        return configured.trim();
    }

    return null;
}

function getPiperHttpUrl(): string | null {
    const configured = process.env.PIPER_HTTP_URL;
    if (!configured || configured.trim() === '') {
        return null;
    }

    return configured.replace(/\/+$/, '');
}

function getPublicApiUrl(): string {
    const configured = process.env.PUBLIC_API_URL;
    if (configured && configured.trim() !== '') {
        return configured.replace(/\/+$/, '');
    }

    return process.env.NODE_ENV === 'production'
        ? 'https://api.domdimabot.com'
        : 'http://localhost:3000';
}

function buildPublicPath(channelID: string, speechID: string): string {
    return `${getPublicApiUrl()}/speech/audio/${encodeURIComponent(channelID)}/${encodeURIComponent(speechID)}`;
}

async function ensureSpeechOutputDir(channelID: string): Promise<string> {
    const outputDir = path.join(DEFAULT_PUBLIC_DIR, channelID);
    await fs.mkdir(outputDir, { recursive: true });
    return outputDir;
}

async function writeHttpResult(response: Response, outputPath: string): Promise<void> {
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, buffer);
}

async function runPiperCli(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
    const args = ['-m', 'piper', '-m', request.voice, '-f', request.outputPath];
    const dataDir = getPiperDataDir();
    if (dataDir) {
        args.push('--data-dir', dataDir);
    }
    args.push('--', request.text);

    return await new Promise<TtsSynthesisResult>((resolve) => {
        const child = spawn(getPiperPythonBin(), args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';

        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr += String(chunk);
        });

        child.on('error', (error) => {
            resolve({
                error: true,
                message: `Failed to start Piper CLI: ${error.message}`
            });
        });

        child.on('close', (code) => {
            if (code !== 0) {
                resolve({
                    error: true,
                    message: stderr.trim() || `Piper CLI exited with code ${code}`
                });
                return;
            }

            resolve({
                error: false,
                message: 'Speech synthesized with Piper CLI',
                outputPath: request.outputPath,
                publicPath: buildPublicPath(request.channelID, request.speechID),
                mimeType: 'audio/wav'
            });
        });
    });
}

async function runPiperHttp(request: TtsSynthesisRequest, baseUrl: string): Promise<TtsSynthesisResult> {
    const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: request.text,
            voice: request.voice
        })
    });

    if (!response.ok) {
        const body = await response.text();
        return {
            error: true,
            message: body || `Piper HTTP synthesis failed with ${response.status}`
        };
    }

    await writeHttpResult(response, request.outputPath);

    return {
        error: false,
        message: 'Speech synthesized with Piper HTTP',
        outputPath: request.outputPath,
        publicPath: buildPublicPath(request.channelID, request.speechID),
        mimeType: 'audio/wav'
    };
}

class PiperTtsService implements TtsProvider {
    readonly name = 'piper';

    async synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
        try {
            const outputDir = await ensureSpeechOutputDir(request.channelID);
            const outputPath = path.join(outputDir, `${request.speechID}.wav`);
            const normalizedRequest: TtsSynthesisRequest = {
                ...request,
                outputPath
            };

            const httpUrl = getPiperHttpUrl();
            if (httpUrl) {
                return await runPiperHttp(normalizedRequest, httpUrl);
            }

            return await runPiperCli(normalizedRequest);
        } catch (error) {
            return {
                error: true,
                message: error instanceof Error ? error.message : String(error)
            };
        }
    }
}

const piperTtsService = new PiperTtsService();

export { piperTtsService, DEFAULT_PUBLIC_DIR as PIPER_PUBLIC_SPEECH_DIR, buildPublicPath };
