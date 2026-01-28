const express = require('express');
const router = express.Router();
const ClipDesign = require('../../../schema/clipDesign');
const logger = require('../../../util/logger');
const { uploadCSS, deleteCSS } = require('../../../util/s3');
const auth = require('../../../middleware/auth');
const { validateCSS } = require('../../../util/cssValidator');

// Apply authentication to all routes except CSS serving
router.use(auth);

// Get all designs for a channel
router.get('/:channelID', async (req, res) => {
    try {
        // Verify channel ownership
        if (req.user.channelID !== req.params.channelID && !req.user.isAdmin) {
            return res.status(403).json({
                error: true,
                message: 'Unauthorized access to channel designs',
                status: 403
            });
        }

        const designs = await ClipDesign.find({ 
            $or: [
                { channelID: req.params.channelID },
                { isPublic: true }
            ]
        });
        
        res.status(200).json({
            error: false,
            designs
        });
    } catch (error) {
        logger({ error: true, message: error.message, status: 500, type: 'error' }, true, req.params.channelID, 'get designs error');
        res.status(500).json({
            error: true,
            message: 'Error fetching designs',
            status: 500
        });
    }
});

// Get a specific design's CSS
router.get('/css/:designId', async (req, res) => {
    try {
        const design = await ClipDesign.findById(req.params.designId);
        
        if (!design) {
            return res.status(404).json({
                error: true,
                message: 'Design not found',
                status: 404
            });
        }

        // Add security headers
        res.set({
            'Content-Security-Policy': "default-src 'self'",
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
        });

        // Redirect to the S3 URL
        res.redirect(design.cssUrl);
    } catch (error) {
        logger({ error: true, message: error.message, status: 500, type: 'error' }, true, req.params.designId, 'get design CSS error');
        res.status(500).json({
            error: true,
            message: 'Error fetching design CSS',
            status: 500
        });
    }
});

// Create a new design
router.post('/:channelID', async (req, res) => {
    try {
        const { name, css, isPublic, isDefault } = req.body;
        
        // Verify channel ownership
        if (req.user.channelID !== req.params.channelID && !req.user.isAdmin) {
            return res.status(403).json({
                error: true,
                message: 'Unauthorized to create designs for this channel',
                status: 403
            });
        }

        if (!name || !css) {
            return res.status(400).json({
                error: true,
                message: 'Name and CSS are required',
                status: 400
            });
        }

        // Validate CSS for security
        const cssValidation = validateCSS(css);
        if (!cssValidation.valid) {
            return res.status(400).json({
                error: true,
                message: 'Invalid CSS: ' + cssValidation.message,
                status: 400
            });
        }

        // Create the design document first to get the ID
        const design = new ClipDesign({
            name,
            channelID: req.params.channelID,
            channel: req.body.channel,
            cssUrl: '', // Will be updated after S3 upload
            isPublic: isPublic || false,
            isDefault: isDefault || false,
            createdBy: req.user._id
        });

        await design.save();

        // Upload CSS to S3 and get the URL
        const cssUrl = await uploadCSS(req.params.channelID, design._id, css);

        // Update the design with the S3 URL
        design.cssUrl = cssUrl;
        await design.save();

        res.status(201).json({
            error: false,
            message: 'Design created successfully',
            design
        });
    } catch (error) {
        logger({ error: true, message: error.message, status: 500, type: 'error' }, true, req.params.channelID, 'create design error');
        res.status(500).json({
            error: true,
            message: 'Error creating design',
            status: 500
        });
    }
});

// Update a design
router.put('/:channelID/:designId', async (req, res) => {
    try {
        const { name, css, isPublic, isDefault } = req.body;
        
        // Find the existing design
        const design = await ClipDesign.findOne({
            _id: req.params.designId,
            channelID: req.params.channelID
        });

        if (!design) {
            return res.status(404).json({
                error: true,
                message: 'Design not found',
                status: 404
            });
        }

        // Verify ownership
        if (design.createdBy.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({
                error: true,
                message: 'Unauthorized to modify this design',
                status: 403
            });
        }

        // If CSS is being updated, validate it
        if (css) {
            const cssValidation = validateCSS(css);
            if (!cssValidation.valid) {
                return res.status(400).json({
                    error: true,
                    message: 'Invalid CSS: ' + cssValidation.message,
                    status: 400
                });
            }
            const cssUrl = await uploadCSS(req.params.channelID, design._id, css);
            design.cssUrl = cssUrl;
        }

        // Update other fields
        design.name = name || design.name;
        design.isPublic = isPublic !== undefined ? isPublic : design.isPublic;
        design.isDefault = isDefault !== undefined ? isDefault : design.isDefault;
        design.updatedAt = Date.now();
        design.updatedBy = req.user._id;

        await design.save();

        res.status(200).json({
            error: false,
            message: 'Design updated successfully',
            design
        });
    } catch (error) {
        logger({ error: true, message: error.message, status: 500, type: 'error' }, true, req.params.channelID, 'update design error');
        res.status(500).json({
            error: true,
            message: 'Error updating design',
            status: 500
        });
    }
});

// Delete a design
router.delete('/:channelID/:designId', async (req, res) => {
    try {
        const design = await ClipDesign.findOne({
            _id: req.params.designId,
            channelID: req.params.channelID
        });

        if (!design) {
            return res.status(404).json({
                error: true,
                message: 'Design not found',
                status: 404
            });
        }

        // Verify ownership
        if (design.createdBy.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({
                error: true,
                message: 'Unauthorized to delete this design',
                status: 403
            });
        }

        // Delete CSS from S3
        await deleteCSS(req.params.channelID, design._id);

        // Delete the design document
        await design.deleteOne();

        res.status(200).json({
            error: false,
            message: 'Design deleted successfully'
        });
    } catch (error) {
        logger({ error: true, message: error.message, status: 500, type: 'error' }, true, req.params.channelID, 'delete design error');
        res.status(500).json({
            error: true,
            message: 'Error deleting design',
            status: 500
        });
    }
});

module.exports = router; 