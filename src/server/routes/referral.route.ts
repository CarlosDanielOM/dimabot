import express, { type Request, type Response } from "express";
import { getDragonflyClient } from "../../utils/databases/dragonfly.database.js";
import { authMiddleware } from "../../middleware/auth.middleware.js";
import UsersSchema, { type IUsers } from "../../schemas/users.schema.js";
import { ReferralCodeSchema } from "../../schemas/referral_code.schema.js";
import {
    createCampaignCode,
    getUserCodes,
    deleteCampaignCode,
    applyReferralCode,
    getReferralStats,
    getUserPlanType,
    REFERRAL_CODE_LIMITS,
    type PlanType
} from "../../utils/referral.js";

async function getUserFromToken(req: Request): Promise<IUsers | null> {
    const token = req.headers['authorization'] || req.headers['Authorization'];

    if (!token) return null;

    const cacheClient = await getDragonflyClient();
    const userData = await cacheClient.hGetAll(`token:${token}`);

    if (!userData || !userData.id) return null;

    const user = await UsersSchema.findById(userData.id);
    return user;
}

export const referralRoute = (app: express.Application): void => {
    app.get('/stats', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const user = await getUserFromToken(req);

            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'User not found',
                    status: 404
                });
            }

            const stats = await getReferralStats(user._id);

            return res.status(200).json({
                error: false,
                message: 'Referral stats fetched successfully',
                status: 200,
                data: stats
            });
        } catch (error) {
            console.error('Error in GET /stats:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

    app.get('/codes', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const user = await getUserFromToken(req);

            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'User not found',
                    status: 404
                });
            }

            const codes = await getUserCodes(user._id);
            const planType = getUserPlanType(user);
            const limit = REFERRAL_CODE_LIMITS[planType];

            return res.status(200).json({
                error: false,
                message: 'Referral codes fetched successfully',
                status: 200,
                data: {
                    codes,
                    planType,
                    limit,
                    remaining: limit - codes.length
                }
            });
        } catch (error) {
            console.error('Error in GET /codes:', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

    app.post('/codes', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const user = await getUserFromToken(req);

            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'User not found',
                    status: 404
                });
            }

            const { code, label } = req.body;

            if (!code) {
                return res.status(400).json({
                    error: true,
                    message: 'Code is required',
                    status: 400
                });
            }

            const referralCode = await createCampaignCode(user._id, code, label || '');

            return res.status(201).json({
                error: false,
                message: 'Referral code created successfully',
                status: 201,
                data: referralCode
            });
        } catch (error) {
            console.error('Error in POST /codes:', {
                body: req.body,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            if (error instanceof Error) {
                if (error.message.includes('Limit reached')) {
                    return res.status(403).json({
                        error: true,
                        message: error.message,
                        status: 403
                    });
                }

                if (error.message.includes('already taken') || error.message.includes('Invalid code format')) {
                    return res.status(400).json({
                        error: true,
                        message: error.message,
                        status: 400
                    });
                }
            }

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

    app.delete('/codes/:codeId', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const user = await getUserFromToken(req);

            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'User not found',
                    status: 404
                });
            }

            const { codeId } = req.params;
            const codeIdStr = Array.isArray(codeId) ? codeId[0] : codeId;

            const success = await deleteCampaignCode(user._id, new (require('mongodb').ObjectId)(codeIdStr));

            if (!success) {
                return res.status(404).json({
                    error: true,
                    message: 'Referral code not found or already deleted',
                    status: 404
                });
            }

            return res.status(200).json({
                error: false,
                message: 'Referral code deleted successfully',
                status: 200
            });
        } catch (error) {
            console.error('Error in DELETE /codes/:codeId:', {
                codeId: req.params.codeId,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

    app.post('/apply', authMiddleware as any, async (req: Request, res: Response) => {
        try {
            const user = await getUserFromToken(req);

            if (!user) {
                return res.status(404).json({
                    error: true,
                    message: 'User not found',
                    status: 404
                });
            }

            if (user.referrerId) {
                return res.status(400).json({
                    error: true,
                    message: 'Referral code already applied to this account',
                    status: 400
                });
            }

            const { code } = req.body;

            if (!code) {
                return res.status(400).json({
                    error: true,
                    message: 'Code is required',
                    status: 400
                });
            }

            const success = await applyReferralCode(user._id, code);

            if (!success) {
                return res.status(400).json({
                    error: true,
                    message: 'Invalid referral code or cannot use your own code',
                    status: 400
                });
            }

            return res.status(200).json({
                error: false,
                message: 'Referral code applied successfully',
                status: 200
            });
        } catch (error) {
            console.error('Error in POST /apply:', {
                body: req.body,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });

    app.get('/validate/:code', async (req: Request, res: Response) => {
        try {
            const { code } = req.params;
            const codeStr = Array.isArray(code) ? code[0] : code;

            const referralCode = await ReferralCodeSchema.findByCode(codeStr);

            if (!referralCode) {
                return res.status(404).json({
                    error: true,
                    message: 'Invalid referral code',
                    status: 404,
                    data: { valid: false }
                });
            }

            return res.status(200).json({
                error: false,
                message: 'Valid referral code',
                status: 200,
                data: { valid: true }
            });
        } catch (error) {
            console.error('Error in GET /validate/:code:', {
                code: req.params.code,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString()
            });

            res.status(500).json({
                error: true,
                message: 'Internal server error',
                status: 500
            });
        }
    });
};
