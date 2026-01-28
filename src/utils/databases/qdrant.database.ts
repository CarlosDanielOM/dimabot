import { QdrantClient } from "@qdrant/qdrant-js";

type QdrantConnection = QdrantClient;

let connectionPromise: Promise<QdrantConnection> | null = null;

export const getQdrantConnection = async (caller: string = 'unknown'): Promise<QdrantConnection> => {
    if (connectionPromise) return connectionPromise;

    const initConnection = async () => {

        if (!process.env.QDRANT_HOST || !process.env.QDRANT_PORT || !process.env.QDRANT_API_KEY) {
            throw new Error('QDRANT_HOST, QDRANT_PORT, or QDRANT_API_KEY is not set');
        }

        const client = new QdrantClient({
            url: `http://${process.env.QDRANT_HOST}:${process.env.QDRANT_PORT}`,
            apiKey: process.env.QDRANT_API_KEY,
        });

        try {
            const collections = await client.getCollections();
            console.log(`Connected to Qdrant from ${caller}`);
            console.log(`${collections.collections.length} collections found`);
            return client as QdrantConnection;
        } catch (error) {
            console.error(`Error connecting to Qdrant from ${caller}`, error);
            connectionPromise = null;
            throw error;
        }

        return client as QdrantConnection;
    }

    connectionPromise = initConnection();
    return connectionPromise;
}