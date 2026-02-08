/**
 * Shared AI Constants
 * 
 * Model tiers and token limits used across AI modules.
 */

export const MODELS = {
    free: 'sao10k/l3-lunaris-8b:nitro',
    premium: 'nousresearch/hermes-4-70b:nitro',
    pro: 'minimax/minimax-m2-her:nitro'
} as const;

export const TOKEN_LIMITS = {
    default: 10000
} as const;

export const CODING_MODELS = {
    pro: 'google/gemini-2.5-flash-lite',
    premium: 'google/gemini-2.5-flash-lite',
    free: 'z-ai/glm-4.5-air:nitro',
    exhausted: 'z-ai/glm-4.5-air'
} as const;

 export const DEFAULT_TIMEOUT_MS = 8000;

 export const EMBEDDING_MODELS = {
    default: 'baai/bge-m3',
    multilingual: 'baai/bge-m3'
 } as const;

 export const EMBEDDING_DIMENSIONS = {
    'baai/bge-m3': 1024
 } as const;
