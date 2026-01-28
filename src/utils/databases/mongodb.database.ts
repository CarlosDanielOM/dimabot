import mongoose, { Mongoose } from "mongoose";

type MongoDBConnection = Mongoose;

let connectionPromise: Promise<MongoDBConnection> | null = null;

export const getMongoDBConnection = async (caller: string = 'unknown') => {
    if (connectionPromise) return connectionPromise;

    const initConnection = async () => {
        mongoose.connection.on('error', (error) => {
            console.error(`Error connecting to MongoDB from ${caller}`, error);
        });

        mongoose.connection.on('connected', () => {
            console.log(`Connected to MongoDB from ${caller}`);
        });

        mongoose.connection.on('disconnected', () => {
            console.log(`MongoDB has been successfuly disconected from ${caller}`);
        });

        try {
            if (!process.env.MONGO_URI) {
                throw new Error('MONGO_URI is not set');
            }
            const connection = await mongoose.connect(process.env.MONGO_URI!);
            return connection;
        } catch (error) {
            console.error(`Error connecting to MongoDB from ${caller}`, error);
            connectionPromise = null;
            throw error;
        }
    }

    connectionPromise = initConnection();
    return connectionPromise;
}