const express = require('express');
const router = express.Router();
const Channel = require('../../../schema/channel');
const auth = require('../../../middleware/auth');
const { getClient } = require('../../../util/database/dragonfly');
const {
    createCampaignCode,
    getUserCodes,
    deleteCampaignCode,
    applyReferralCode,
    getReferralStats,
    getUserPlanType,
    REFERRAL_CODE_LIMITS
} = require('../../../util/referral');

/**
 * Helper to get user ID from auth token
 */
async function getUserFromToken(req) {
    const token = req.headers['authorization'] || req.headers['Authorization'];
    if (!token) return null;
    
    const cacheClient = getClient();
    const userData = await cacheClient.hgetall(`token:${token}`);
    
    if (!userData || !userData.id) return null;
    
    // Find channel by twitch_user_id
    const channel = await Channel.findOne({ twitch_user_id: userData.id });
    return channel;
}

/**
 * GET /referral/stats
 * Get referral statistics for the authenticated user
 */
router.get('/stats', auth, async (req, res) => {
    try {
        const channel = await getUserFromToken(req);
        if (!channel) {
            return res.status(404).json({
                error: true,
                message: 'User not found',
                status: 404
            });
        }

        const stats = await getReferralStats(channel._id);
        
        return res.status(200).json({
            error: false,
            message: 'Referral stats fetched successfully',
            status: 200,
            data: stats
        });
    } catch (error) {
        console.error('Error fetching referral stats:', error);
        return res.status(500).json({
            error: true,
            message: error.message || 'Error fetching referral stats',
            status: 500
        });
    }
});

/**
 * GET /referral/codes
 * Get all referral codes for the authenticated user
 */
router.get('/codes', auth, async (req, res) => {
    try {
        const channel = await getUserFromToken(req);
        if (!channel) {
            return res.status(404).json({
                error: true,
                message: 'User not found',
                status: 404
            });
        }

        const codes = await getUserCodes(channel._id);
        const planType = getUserPlanType(channel);
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
        console.error('Error fetching referral codes:', error);
        return res.status(500).json({
            error: true,
            message: error.message || 'Error fetching referral codes',
            status: 500
        });
    }
});

/**
 * POST /referral/codes
 * Create a new referral code
 * Body: { code: string, label?: string }
 */
router.post('/codes', auth, async (req, res) => {
    try {
        const channel = await getUserFromToken(req);
        if (!channel) {
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

        const referralCode = await createCampaignCode(channel._id, code, label || '');
        
        return res.status(201).json({
            error: false,
            message: 'Referral code created successfully',
            status: 201,
            data: referralCode
        });
    } catch (error) {
        console.error('Error creating referral code:', error);
        
        // Handle specific errors
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
        
        return res.status(500).json({
            error: true,
            message: error.message || 'Error creating referral code',
            status: 500
        });
    }
});

/**
 * DELETE /referral/codes/:codeId
 * Delete a referral code
 */
router.delete('/codes/:codeId', auth, async (req, res) => {
    try {
        const channel = await getUserFromToken(req);
        if (!channel) {
            return res.status(404).json({
                error: true,
                message: 'User not found',
                status: 404
            });
        }

        const { codeId } = req.params;
        const success = await deleteCampaignCode(channel._id, codeId);
        
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
        console.error('Error deleting referral code:', error);
        return res.status(500).json({
            error: true,
            message: error.message || 'Error deleting referral code',
            status: 500
        });
    }
});

/**
 * POST /referral/apply
 * Apply a referral code to the current user (during signup/first visit)
 * Body: { code: string }
 */
router.post('/apply', auth, async (req, res) => {
    try {
        const channel = await getUserFromToken(req);
        if (!channel) {
            return res.status(404).json({
                error: true,
                message: 'User not found',
                status: 404
            });
        }

        // Check if user already has a referrer
        if (channel.referrerId) {
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

        const success = await applyReferralCode(channel._id, code);
        
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
        console.error('Error applying referral code:', error);
        return res.status(500).json({
            error: true,
            message: error.message || 'Error applying referral code',
            status: 500
        });
    }
});

/**
 * GET /referral/validate/:code
 * Validate if a referral code exists (public endpoint for signup flow)
 */
router.get('/validate/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const ReferralCode = require('../../../schema/referralCode');
        
        const referralCode = await ReferralCode.findByCode(code);
        
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
        console.error('Error validating referral code:', error);
        return res.status(500).json({
            error: true,
            message: 'Error validating referral code',
            status: 500
        });
    }
});

module.exports = router;
