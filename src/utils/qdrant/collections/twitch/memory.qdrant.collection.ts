import type { IQdrantCollectionOptions } from "../../../../interfaces/qdrant/collections.interface.js";

export const TwitchChannelMemoriesQdrantCollection: IQdrantCollectionOptions = {
    collection_name: 'twitch_channel_memories',
    vectors: {
        size: 1024,
        distance: 'Cosine',
        on_disk: true,
    },
    quantization_config: {
        scalar: {
            type: 'int8',
            quantile: 0.99,
            always_ram: true,
        }
    },
    payload_indexes: [
        { field_name: 'memory_id', field_schema: 'keyword' },
        { field_name: 'channel_id', field_schema: 'keyword' },
        { field_name: 'memory_type', field_schema: 'keyword' },
        { field_name: 'status', field_schema: 'keyword' },
        { field_name: 'risk', field_schema: 'keyword' },
        { field_name: 'confidence', field_schema: 'float' },
        { field_name: 'subject_scope', field_schema: 'keyword' },
        { field_name: 'subject_username', field_schema: 'keyword' },
        { field_name: 'content', field_schema: 'text', tokenizer: 'multilingual' },
        { field_name: 'summary', field_schema: 'text', tokenizer: 'multilingual' },
        { field_name: 'created_at', field_schema: 'integer' },
        { field_name: 'updated_at', field_schema: 'integer' }
    ]
};
