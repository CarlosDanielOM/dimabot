import { generateEmbeddings, detectLanguage } from '../utils/ai/openrouter/embeddings.ai.js';
import { EMBEDDING_MODELS } from '../utils/ai/constants.js';
import { getQdrantConnection } from '../utils/databases/qdrant.database.js';
import { error, debug } from '../utils/logger.js';
import { createHash } from 'crypto';

export interface IQueuedMessage {
    text: string;
    channel_id: string;
    channel_name?: string;
    username: string;
    user_id: string;
    timestamp: number;
    language?: string;
}

const COLLECTION_NAME = 'twitch_chat_logs';

function generatePointId(channelId: string, userId: string, timestamp: number): number {
    const hash = createHash('md5')
        .update(`${channelId}:${userId}:${timestamp}`)
        .digest('hex');
    return parseInt(hash.substring(0, 8), 16);
}

class EmbeddingBatcher {
    private queue: IQueuedMessage[] = [];
    private timer: NodeJS.Timeout | null = null;
    private readonly BATCH_SIZE_LIMIT = 500;
    private readonly BATCH_INTERVAL = 350;
    private readonly MAX_RETRIES = 3;
    private isProcessing = false;

    addMessage(message: IQueuedMessage): void {
        this.queue.push(message);

        if (this.queue.length >= this.BATCH_SIZE_LIMIT) {
            clearTimeout(this.timer!);
            this.timer = null;
            this.processBatch();
        } else if (!this.timer && !this.isProcessing) {
            this.timer = setTimeout(() => {
                this.processBatch();
            }, this.BATCH_INTERVAL);
        }
    }

    private async processBatch(): Promise<void> {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;
        this.timer = null;

        const messagesToProcess = [...this.queue];
        this.queue = [];

        try {
            await this.sendBatch(messagesToProcess, 1);
        } catch (err) {
            error({
                message: 'Critical error in batch processing',
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                batchSize: messagesToProcess.length
            });
        } finally {
            this.isProcessing = false;

            if (this.queue.length > 0 && !this.timer) {
                this.timer = setTimeout(() => {
                    this.processBatch();
                }, this.BATCH_INTERVAL);
            }
        }
    }

    private async sendBatch(messages: IQueuedMessage[], attempt: number): Promise<void> {
        try {
            const startTime = Date.now();

            const result = await generateEmbeddings(
                messages.map(m => m.text),
                EMBEDDING_MODELS.default
            );

            if (result.error || !result.embeddings) {
                throw new Error(result.message || 'Failed to generate embeddings');
            }

            const embeddingTime = Date.now() - startTime;

            await this.storeInQdrant(messages, result.embeddings);

            const totalTime = Date.now() - startTime;

            debug({
                message: 'Batch embeddings stored successfully',
                batchSize: messages.length,
                embeddingTime,
                totalTime,
                attempt
            }, { destination: 'cache' });
        } catch (err) {
            if (attempt < this.MAX_RETRIES) {
                const delay = attempt * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                await this.sendBatch(messages, attempt + 1);
            } else {
                error({
                    message: 'Batch failed after maximum retries',
                    error: err instanceof Error ? err.message : String(err),
                    batchSize: messages.length,
                    attempts: attempt
                });
                throw err;
            }
        }
    }

    private async storeInQdrant(messages: IQueuedMessage[], embeddings: number[][]): Promise<void> {
        try {
            const qdrantClient = await getQdrantConnection('EmbeddingBatcher');

            const points = messages.map((msg, index) => {
                const pointId = generatePointId(msg.channel_id, msg.user_id, msg.timestamp);
                return {
                    id: pointId,
                    vector: embeddings[index],
                    payload: {
                        channel_id: msg.channel_id,
                        channel_name: msg.channel_name,
                        username: msg.username,
                        user_id: msg.user_id,
                        message: msg.text,
                        timestamp: msg.timestamp,
                        language: msg.language || detectLanguage(msg.text)
                    }
                };
            });

            await qdrantClient.upsert(COLLECTION_NAME, {
                wait: false,
                points
            });
        } catch (err) {
            error({
                message: 'Error storing batch embeddings in Qdrant',
                error: err instanceof Error ? err.message : String(err),
                stack: err instanceof Error ? err.stack : undefined,
                batchSize: messages.length
            });
            throw err;
        }
    }

    getQueueSize(): number {
        return this.queue.length;
    }

    isProcessingBatch(): boolean {
        return this.isProcessing;
    }
}

export default new EmbeddingBatcher();
