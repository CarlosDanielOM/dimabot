import type { IQdrantCollectionOptions } from "../../../../interfaces/qdrant/collections.interface.js";
import type { IReturn } from "../../../../interfaces/tbd/return.interface.js";
import { getQdrantConnection } from "../../../databases/qdrant.database.js";

export const createQdrantCollection = async (collection: IQdrantCollectionOptions): Promise<IReturn<any>> => {
    const qdrantClient = await getQdrantConnection('createQdrantCollection');

    let config: any = {
        vectors: {
            size: collection.vectors.size,
            distance: collection.vectors.distance,
            on_disk: collection.vectors.on_disk,
        }
    }

    if(collection.quantization_config) {
        config.quantization_config = collection.quantization_config;
    }

    try {
        const exists = await qdrantClient.collectionExists(collection.collection_name);
        if(!exists.exists) {
            await qdrantClient.createCollection(collection.collection_name, config);
        } else {
            return {
                error: true,
                message: `Collection ${collection.collection_name} already exists`,
                reason: null,
                status: 409,
                type: 'collection_already_exists',
                data: null
            };
        }

        if(collection.payload_indexes.length > 0) {
            for (const index of collection.payload_indexes) {
                await qdrantClient.createPayloadIndex(collection.collection_name, index);
            }
        }

        return {
            error: false,
            message: `Collection ${collection.collection_name} created`,
            reason: null,
            status: 200,
            type: 'success',
            data: null
        };
    } catch (error) {
        console.error(`Error creating Qdrant collection ${collection.collection_name}`, error);
        return {
            error: true,
            message: `Error creating Qdrant collection ${collection.collection_name}`,
            reason: (error as Error).message,
            status: 500,
            type: 'error',
            data: null
        }
    }

}