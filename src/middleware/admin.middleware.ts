import type { NextFunction, Request, Response } from 'express';
import { AdminSchema } from '../schemas/admin.schema.js';
import type { AuthRequest } from './types.js';
import { error } from '../utils/logger.js';

export async function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!req.user || !req.user.id) {
            res.status(401).json({
                error: true,
                message: 'Authentication required',
                status: 401,
                type: 'authentication_required'
            });
            return;
        }

        const admin = await AdminSchema.findOne({
            adminID: req.user.id,
            actived: true
        });

        if (!admin) {
            res.status(403).json({
                error: true,
                message: 'Admin privileges required',
                status: 403,
                type: 'admin_required'
            });
            return;
        }

        next();
    } catch (err) {
        await error({
            function: 'adminMiddleware',
            userId: req.user?.id,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined
        }, { destination: 'both' });

        res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500,
            type: 'internal_error'
        });
    }
}
