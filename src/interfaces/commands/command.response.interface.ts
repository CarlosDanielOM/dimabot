import type { ICommands } from '../../schemas/commands.schema.js';

export interface ICommandCreateResponse {
    error: boolean;
    created?: boolean;
    message: string;
    status: number;
    type: string;
    command?: ICommands;
}

export interface ICommandDeleteResponse {
    error: boolean;
    deleted?: boolean;
    message: string;
    status: number;
    type: string;
    command?: ICommands;
}

export interface ICommandGetResponse {
    error: boolean;
    message: string;
    status: number;
    type: string;
    command?: ICommands;
}

export interface ICommandUpdateResponse {
    error: boolean;
    message: string;
    status: number;
    type: string;
}

export interface ICommandExistsResponse {
    error: boolean;
    message: string;
    status: number;
    type: string;
    command?: ICommands;
}
