export interface IReturn<T> {
    error: boolean;
    message: string;
    reason: string | null;
    status: number;
    type: string;
    data: T | null;
}