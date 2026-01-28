import type { IQdrantCollectionOptions } from "../../../../interfaces/qdrant/collections.interface.js";

export const TwitchChatLogsQdrantCollection: IQdrantCollectionOptions = {
    collection_name: 'twitch_chat_logs',
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
        {field_name: 'username', field_schema: 'keyword'},
        {field_name: 'message', field_schema: 'text', tokenizer: 'multilingual'},
        {field_name: 'channel', field_schema: 'keyword'},
        {field_name: 'user_id', field_schema: 'keyword'},
        {field_name: 'timestamp', field_schema: 'integer'},
        {field_name: 'language', field_schema: 'keyword'},
        {field_name: 'channel_id', field_schema: 'keyword'},
    ]
}