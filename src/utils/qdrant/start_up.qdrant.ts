import { QDRANT_COLLECTIONS } from "../../config/qdrant/collections.js";
import type { IReturn } from "../../interfaces/tbd/return.interface.js";
import { createQdrantCollection } from "./functions/collections/create.collecion.js";

export const QdrantStartUp = async () => {

    const results: IReturn<any>[] = [];
    
    let skipped_collections: number = 0;
    
    try {
        for (const collection of QDRANT_COLLECTIONS) {
            const result = await createQdrantCollection(collection);
            results.push(result);

            if(result.error) {
                result.reason !== null ? console.error(`Error creating Qdrant collection ${collection.collection_name}`, result.reason) : null;
            } else if(result.status === 201) {
                console.log(`Qdrant collection ${collection.collection_name} created successfully`);
            } else if(result.status === 409) {
                // console.log(`Qdrant collection ${collection.collection_name} already exists`);
                skipped_collections++;
            }
        }

        console.log('Qdrant Initialization completed, created collections:', results.length - skipped_collections, 'skipped collections:', skipped_collections);
        
        return {
            error: false,
            message: 'Qdrant collections created',
            reason: null,
            status: 200,
            type: 'success',
            data: results
        }
        
    } catch (error) {
        console.error('Error starting up Qdrant', error);
        return {
            error: true,
            message: 'Error starting up Qdrant',
            reason: (error as Error).message,
            status: 500,
            type: 'error',
            data: null
        }
    }
}