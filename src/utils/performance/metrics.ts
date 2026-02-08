import { getDragonflyClient } from '../databases/dragonfly.database.js';

export interface IPerformanceMetrics {
    operation: string;
    startTime: number;
    endTime: number;
    duration: number;
    success: boolean;
    errorMessage?: string;
    metadata?: Record<string, any>;
}

export interface IPerformanceStats {
    totalCount: number;
    successCount: number;
    errorCount: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    lastUpdated: number;
}

const METRICS_TTL = 60 * 60 * 24;

const activeMetrics = new Map<string, number>();

export class PerformanceMonitor {
    private prefix: string;

    constructor(prefix: string = 'performance') {
        this.prefix = prefix;
    }

    start(operation: string, metadata?: Record<string, any>): string {
        const metricId = `${this.prefix}:${operation}:${Date.now()}`;
        const startTime = Date.now();
        
        activeMetrics.set(metricId, startTime);

        return metricId;
    }

    async end(metricId: string, success: boolean, errorMessage?: string, additionalMetadata?: Record<string, any>): Promise<void> {
        const startTime = activeMetrics.get(metricId);
        
        if (!startTime) {
            return;
        }

        activeMetrics.delete(metricId);

        const endTime = Date.now();
        const duration = endTime - startTime;
        const operation = metricId.split(':')[1];

        const metrics: IPerformanceMetrics = {
            operation,
            startTime,
            endTime,
            duration,
            success,
            errorMessage,
            metadata: additionalMetadata
        };

        try {
            const cache = await getDragonflyClient('PerformanceMonitor');
            const key = `${this.prefix}:${operation}:metrics`;
            
            await cache.incr(`${key}:count`);
            
            if (success) {
                await cache.incr(`${key}:success`);
            } else {
                await cache.incr(`${key}:error`);
            }

            const totalDuration = await cache.incrBy(`${key}:totalDuration`, duration);
            const totalCount = parseInt(await cache.get(`${key}:count`) || '0', 10);
            const avgDuration = totalCount > 0 ? totalDuration / totalCount : 0;

            const currentMin = await cache.get(`${key}:minDuration`);
            const currentMax = await cache.get(`${key}:maxDuration`);

            if (!currentMin || duration < parseInt(currentMin, 10)) {
                await cache.set(`${key}:minDuration`, duration.toString());
            }

            if (!currentMax || duration > parseInt(currentMax, 10)) {
                await cache.set(`${key}:maxDuration`, duration.toString());
            }

            await cache.set(`${key}:lastUpdated`, Date.now().toString());
            await cache.expire(key, METRICS_TTL);
            await cache.expire(`${key}:count`, METRICS_TTL);
            await cache.expire(`${key}:success`, METRICS_TTL);
            await cache.expire(`${key}:error`, METRICS_TTL);
            await cache.expire(`${key}:totalDuration`, METRICS_TTL);
            await cache.expire(`${key}:minDuration`, METRICS_TTL);
            await cache.expire(`${key}:maxDuration`, METRICS_TTL);
            await cache.expire(`${key}:lastUpdated`, METRICS_TTL);

        } catch (err) {
            console.error('Error storing performance metrics:', err);
        }
    }

    async getStats(operation: string): Promise<IPerformanceStats | null> {
        try {
            const cache = await getDragonflyClient('PerformanceMonitor');
            const key = `${this.prefix}:${operation}:metrics`;

            const count = await cache.get(`${key}:count`);
            const success = await cache.get(`${key}:success`);
            const error = await cache.get(`${key}:error`);
            const totalDuration = await cache.get(`${key}:totalDuration`);
            const minDuration = await cache.get(`${key}:minDuration`);
            const maxDuration = await cache.get(`${key}:maxDuration`);
            const lastUpdated = await cache.get(`${key}:lastUpdated`);

            if (!count) {
                return null;
            }

            const countNum = parseInt(count, 10);
            const successNum = parseInt(success || '0', 10);
            const errorNum = parseInt(error || '0', 10);
            const totalDurationNum = parseInt(totalDuration || '0', 10);
            const minDurationNum = minDuration ? parseInt(minDuration, 10) : 0;
            const maxDurationNum = maxDuration ? parseInt(maxDuration, 10) : 0;
            const lastUpdatedNum = lastUpdated ? parseInt(lastUpdated, 10) : 0;
            const avgDurationNum = countNum > 0 ? totalDurationNum / countNum : 0;

            return {
                totalCount: countNum,
                successCount: successNum,
                errorCount: errorNum,
                avgDuration: avgDurationNum,
                minDuration: minDurationNum,
                maxDuration: maxDurationNum,
                lastUpdated: lastUpdatedNum
            };
        } catch (err) {
            console.error('Error getting performance stats:', err);
            return null;
        }
    }

    async getAllStats(): Promise<Record<string, IPerformanceStats>> {
        try {
            const cache = await getDragonflyClient('PerformanceMonitor');
            const keys = await cache.keys(`${this.prefix}:*:metrics`);

            const stats: Record<string, IPerformanceStats> = {};

            for (const key of keys) {
                const operation = key.replace(`${this.prefix}:`, '').replace(':metrics', '');
                const stat = await this.getStats(operation);
                if (stat) {
                    stats[operation] = stat;
                }
            }

            return stats;
        } catch (err) {
            console.error('Error getting all performance stats:', err);
            return {};
        }
    }

    async reset(operation?: string): Promise<void> {
        try {
            const cache = await getDragonflyClient('PerformanceMonitor');
            
            if (operation) {
                const key = `${this.prefix}:${operation}:metrics`;
                const keysToDelete = await cache.keys(`${key}:*`);
                for (const k of keysToDelete) {
                    await cache.del(k);
                }
            } else {
                const keys = await cache.keys(`${this.prefix}:*`);
                for (const k of keys) {
                    await cache.del(k);
                }
            }
        } catch (err) {
            console.error('Error resetting performance metrics:', err);
        }
    }
}

export const embeddingMonitor = new PerformanceMonitor('embeddings');
export const qdrantMonitor = new PerformanceMonitor('qdrant');
