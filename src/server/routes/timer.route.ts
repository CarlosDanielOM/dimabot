import express, { type Request, type Response } from 'express';
import { createTimer, deleteTimer, editTimer, getTimer, listTimers, toggleTimer } from '../../commands/timer_manager.command.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { error as logError } from '../../utils/logger.js';

const router = express.Router();

router.get('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const result = await listTimers(channelIdStr);

        return res.status(result.status || 200).json({
            error: result.error,
            message: result.message,
            status: result.status || 200,
            data: result.timers || []
        });
    } catch (err) {
        await logError({
            function: 'timerRoute.listTimers',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.get('/:channelID/:timerName', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID, timerName } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const timerNameStr = Array.isArray(timerName) ? timerName[0] : timerName;
        const result = await getTimer(channelIdStr, timerNameStr);

        return res.status(result.status || 200).json({
            error: result.error,
            message: result.message,
            status: result.status || 200,
            data: result.timer || null
        });
    } catch (err) {
        await logError({
            function: 'timerRoute.getTimer',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            timerName: req.params.timerName,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.post('/:channelID', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const { name, frequency, message } = req.body as { name?: string; frequency?: number; message?: string };

        if (!name) {
            return res.status(400).json({
                error: true,
                message: 'Timer name is required',
                status: 400
            });
        }

        if (frequency === undefined || frequency === null) {
            return res.status(400).json({
                error: true,
                message: 'Frequency is required',
                status: 400
            });
        }

        if (!message) {
            return res.status(400).json({
                error: true,
                message: 'Message is required',
                status: 400
            });
        }

        const result = await createTimer(channelIdStr, name, frequency, message);

        return res.status(result.status || 201).json({
            error: result.error,
            message: result.message,
            status: result.status || 201,
            data: result.timer || null
        });
    } catch (err) {
        await logError({
            function: 'timerRoute.createTimer',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.patch('/:channelID/:timerName', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID, timerName } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const timerNameStr = Array.isArray(timerName) ? timerName[0] : timerName;
        const { frequency, message } = req.body as { frequency?: number; message?: string };

        if (frequency === undefined && message === undefined) {
            return res.status(400).json({
                error: true,
                message: 'At least one of frequency or message must be provided',
                status: 400
            });
        }

        const result = await editTimer(channelIdStr, timerNameStr, frequency, message);

        return res.status(result.status || 200).json({
            error: result.error,
            message: result.message,
            status: result.status || 200,
            data: result.timer || null
        });
    } catch (err) {
        await logError({
            function: 'timerRoute.editTimer',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            timerName: req.params.timerName,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.patch('/:channelID/:timerName/toggle', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID, timerName } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const timerNameStr = Array.isArray(timerName) ? timerName[0] : timerName;
        const { active } = req.body as { active?: boolean };
        const result = await toggleTimer(channelIdStr, timerNameStr, active);

        return res.status(result.status || 200).json({
            error: result.error,
            message: result.message,
            status: result.status || 200,
            data: result.timer || null
        });
    } catch (err) {
        await logError({
            function: 'timerRoute.toggleTimer',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            timerName: req.params.timerName,
            body: req.body,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

router.delete('/:channelID/:timerName', authMiddleware as any, async (req: Request, res: Response) => {
    try {
        const { channelID, timerName } = req.params;
        const channelIdStr = Array.isArray(channelID) ? channelID[0] : channelID;
        const timerNameStr = Array.isArray(timerName) ? timerName[0] : timerName;
        const result = await deleteTimer(channelIdStr, timerNameStr);

        return res.status(result.status || 200).json({
            error: result.error,
            message: result.message,
            status: result.status || 200,
            data: result.timer || null
        });
    } catch (err) {
        await logError({
            function: 'timerRoute.deleteTimer',
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            channelID: req.params.channelID,
            timerName: req.params.timerName,
            timestamp: new Date().toISOString()
        }, { destination: 'both' });

        return res.status(500).json({
            error: true,
            message: 'Internal server error',
            status: 500
        });
    }
});

export const timerRoute = router;
