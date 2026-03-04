export interface ThreadLimits {
    maxChannelThreads: number;
    maxUserThreads: number;
    maxTurnsStored: number;
    promptTurns: number;
}

export type PlanTier = 'pro' | 'premium' | 'free';

export function getThreadLimitsForTier(planTier: PlanTier): ThreadLimits {
    if (planTier === 'pro') {
        return {
            maxChannelThreads: 100,
            maxUserThreads: 5,
            maxTurnsStored: 50,
            promptTurns: 12
        };
    }
    if (planTier === 'premium') {
        return {
            maxChannelThreads: 40,
            maxUserThreads: 2,
            maxTurnsStored: 20,
            promptTurns: 5
        };
    }
    return {
        maxChannelThreads: 20,
        maxUserThreads: 1,
        maxTurnsStored: 10,
        promptTurns: 2
    };
}
