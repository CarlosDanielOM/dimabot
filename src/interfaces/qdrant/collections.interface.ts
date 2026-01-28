interface IQdrantCollectionIndexOptions {
    field_name: string;
    field_schema: 'keyword' | 'integer' | 'float' | 'geo' | 'text' | 'bool' | 'datetime' | 'uuid';
    tokenizer?: 'word' | 'whitespace' | 'prefix' | 'multilingual'
}

export interface IQdrantCollectionOptions {
    collection_name: string;
    vectors: {
        size: number;
        distance: 'Cosine' | 'Euclid' | 'Dot';
        on_disk: boolean;
    };
    quantization_config?: {
        scalar?: {
            type?: 'int4' | 'int8' | 'int32';
            data_type?: 'float16';
            quantile: number;
            always_ram: boolean;
        };
        binary?: {
            always_ram: boolean;
        };
    };
    payload_indexes: IQdrantCollectionIndexOptions[];
}