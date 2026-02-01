import fs from 'fs';
import { exec } from 'node:child_process';

interface DownloadClipResult {
    error: boolean;
    message: string;
    filePath?: string;
}

export async function downloadClip(
    url: string,
    channelID: string,
    downloadDir: string
): Promise<DownloadClipResult> {
    return new Promise((resolve) => {
        const absoluteDownloadDir = `${process.cwd()}/src/server/routes/public/downloads`;
        const filePath = `${absoluteDownloadDir}/${channelID}-clip.mp4`;

        if (!fs.existsSync(absoluteDownloadDir)) {
            fs.mkdirSync(absoluteDownloadDir, { recursive: true });
        }

        const command = `twitch-dl download -q 480p -o "${filePath}" "${url}"`;
        const downloadProcess = exec(command);

        let stdoutData = '';
        let stderrData = '';

        if (downloadProcess.stdout) {
            downloadProcess.stdout.on('data', (data) => {
                stdoutData += data;
            });
        }

        if (downloadProcess.stderr) {
            downloadProcess.stderr.on('data', (data) => {
                stderrData += data;
            });
        }

        const timeout = setTimeout(() => {
            console.log(`Timeout triggered for ${channelID} downloading ${url}`);
            downloadProcess.kill();

            resolve({
                error: true,
                message: `Download timeout after 10 seconds for URL: ${url}`
            });
        }, 10000);

        downloadProcess.on('exit', (code) => {
            clearTimeout(timeout);

            if (code === 0) {
                resolve({
                    error: false,
                    message: 'Success',
                    filePath
                });
            } else {
                const errorMessage = `Clip download failed with exit code: ${code}. Stderr: ${stderrData || 'No stderr output.'} Stdout: ${stdoutData || 'No stdout output.'}`;

                console.error(`Error in downloadClip:`, {
                    channelID,
                    clipUrl: url,
                    errorMessage,
                    timestamp: new Date().toISOString()
                });

                resolve({
                    error: true,
                    message: errorMessage
                });
            }
        });

        downloadProcess.on('error', (err) => {
            clearTimeout(timeout);

            console.error(`Error in downloadClip:`, {
                channelID,
                clipUrl: url,
                error: err.message,
                timestamp: new Date().toISOString()
            });

            resolve({
                error: true,
                message: `Clip download failed to start or run: ${err.message}`
            });
        });
    });
}

export async function deleteOldClip(
    channelID: string,
    deleteDir: string
): Promise<void> {
    const filePath = `${deleteDir}/${channelID}-clip.mp4`;

    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error(`Error in deleteOldClip:`, {
            channelID,
            filePath,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
        });
    }
}

export async function checkIfClipExists(
    channelID: string,
    downloadDir: string
): Promise<boolean> {
    const filePath = `${downloadDir}/${channelID}-clip.mp4`;
    return fs.existsSync(filePath);
}
