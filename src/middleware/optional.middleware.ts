import type { NextFunction, Request, Response } from 'express';
import { authMiddleware } from './auth.middleware.js';
import type { AuthRequest } from './types.js';

export async function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    let hasBeenCalled = false;

    const mockNext = () => {
        hasBeenCalled = true;
    };

    await authMiddleware(req, res, mockNext);

    if (!hasBeenCalled) {
        req.user = undefined;
    }

    next();
}
