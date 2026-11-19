const Listing = require("../models/listing");
const aiService = require("../services/aiService");
const listingAIService = require("../services/listingAIService");
const reviewAIService = require("../services/reviewAIService");
const searchAIService = require("../services/searchAIService");
const mongoose = require("mongoose");

/**
 * Renders the AI Tools Hub overview page.
 */
module.exports.renderToolsHub = (req, res) => {
    res.render("ai/tools-hub.ejs", {
        pageTitle: "Nikunj AI - Generative AI Suite"
    });
};

/**
 * FEATURE 1: Renders the AI Listing Generator page.
 * Optionally pre-populates fields if a listingId query parameter is provided
 * and verifies that the current user owns that listing.
 */
module.exports.renderListingGenerator = async (req, res) => {
    const { listingId } = req.query;
    let targetListing = null;

    if (listingId) {
        if (!mongoose.Types.ObjectId.isValid(listingId)) {
            req.flash("error", "Invalid listing ID provided.");
            return res.redirect("/listings");
        }

        targetListing = await Listing.findById(listingId);
        if (!targetListing) {
            req.flash("error", "Listing not found.");
            return res.redirect("/listings");
        }

        // Ownership verification
        if (!targetListing.owner || !targetListing.owner.equals(req.user._id)) {
            req.flash("error", "You can only use the AI Generator for listings you own.");
            return res.redirect(`/listings/${listingId}`);
        }
    }

    res.render("ai/listing-generator.ejs", {
        targetListing,
        pageTitle: "AI Listing Generator - Nikunj AI"
    });
};

/**
 * FEATURE 1: Handles the generation of professional listing content using Gemini AI.
 * Validates ownership if an existing listingId is passed in the request body.
 */
module.exports.generateListing = async (req, res) => {
    try {
        const { listingId } = req.body;

        // If generating content for an existing listing, verify ownership
        if (listingId) {
            if (!mongoose.Types.ObjectId.isValid(listingId)) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid listing ID format."
                });
            }

            const listing = await Listing.findById(listingId);
            if (!listing) {
                return res.status(404).json({
                    success: false,
                    error: "Listing not found."
                });
            }

            if (!listing.owner || !listing.owner.equals(req.user._id)) {
                return res.status(403).json({
                    success: false,
                    error: "Unauthorized: You can only generate content for your own listings."
                });
            }
        }

        const generatedData = await listingAIService.generateListingContent(req.body);

        return res.json({
            success: true,
            data: generatedData
        });
    } catch (err) {
        const statusCode = err.status || 500;
        const errorMessage = aiService.sanitizeSensitiveInfo(
            err.message || "Failed to generate listing content."
        );

        return res.status(statusCode).json({
            success: false,
            error: errorMessage,
            code: err.code || "AI_ERROR"
        });
    }
};

/**
 * FEATURE 2: Returns or generates AI Review Analysis for a specific listing (JSON endpoint).
 * Supports caching and force refresh.
 */
module.exports.analyzeListingReviews = async (req, res) => {
    try {
        const { id } = req.params;
        const forceRefresh = req.query.refresh === "true" || req.body.forceRefresh === true;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                error: "Invalid listing ID format."
            });
        }

        const insights = await reviewAIService.analyzeListingReviews(id, forceRefresh);

        return res.json({
            success: true,
            data: insights
        });
    } catch (err) {
        const statusCode = err.status || 500;
        return res.status(statusCode).json({
            success: false,
            error: aiService.sanitizeSensitiveInfo(err.message || "Failed to analyze reviews."),
            code: err.code || "AI_REVIEW_ERROR"
        });
    }
};

/**
 * FEATURE 2: Renders the dedicated AI Review Insights page for a specific listing.
 */
module.exports.renderListingReviewInsights = async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash("error", "Invalid listing ID.");
        return res.redirect("/listings");
    }

    const listing = await Listing.findById(id).populate({
        path: "reviews",
        populate: { path: "author" }
    }).populate("owner");

    if (!listing) {
        req.flash("error", "Listing not found.");
        return res.redirect("/listings");
    }

    let reviewInsights = null;
    let analysisError = null;

    try {
        // Retrieve fresh or cached review insights
        reviewInsights = await reviewAIService.analyzeListingReviews(id, false);
    } catch (err) {
        console.error("Error retrieving review insights:", err.message);
        analysisError = aiService.sanitizeSensitiveInfo(err.message);
    }

    res.render("ai/review-insights.ejs", {
        listing,
        reviewInsights,
        analysisError,
        pageTitle: `AI Review Insights - ${listing.title}`
    });
};

/**
 * FEATURE 2: Renders an overview list of all listings with their review sentiments.
 */
module.exports.renderAllReviewInsights = async (req, res) => {
    const allListings = await Listing.find({}).populate("reviews").populate("owner");
    res.render("ai/all-review-insights.ejs", {
        allListings,
        pageTitle: "AI Review Intelligence Dashboard - Nikunj AI"
    });
};

/**
 * FEATURE 3: Renders the AI Natural-Language Search page.
 */
module.exports.renderSearchPage = async (req, res) => {
    const query = req.query.q || "";
    let searchResults = null;
    let searchError = null;

    if (query && query.trim()) {
        try {
            searchResults = await searchAIService.searchListingsWithAI(query);
        } catch (err) {
            console.error("AI Search execution error:", err.message);
            searchError = aiService.sanitizeSensitiveInfo(err.message);
        }
    }

    res.render("ai/ai-search.ejs", {
        query,
        searchResults,
        searchError,
        pageTitle: "AI Natural-Language Discovery - Nikunj AI"
    });
};

/**
 * FEATURE 3: AJAX search endpoint returning structured matches and match explanations.
 */
module.exports.executeNaturalSearch = async (req, res) => {
    try {
        const rawQuery = req.body.query || req.query.q || "";
        if (!rawQuery.trim()) {
            return res.status(400).json({
                success: false,
                error: "Search query cannot be empty."
            });
        }

        const results = await searchAIService.searchListingsWithAI(rawQuery);
        return res.json({
            success: true,
            data: results
        });
    } catch (err) {
        const statusCode = err.status || 500;
        return res.status(statusCode).json({
            success: false,
            error: aiService.sanitizeSensitiveInfo(err.message || "Failed to execute AI search.")
        });
    }
};

/**
 * Connectivity and health check endpoint for the AI service.
 */
module.exports.checkStatus = async (req, res) => {
    try {
        const status = await aiService.testConnection();
        return res.json(status);
    } catch (err) {
        const statusCode = err.status || 500;
        return res.status(statusCode).json({
            success: false,
            error: aiService.sanitizeSensitiveInfo(err.message),
            code: err.code || "AI_CONNECTION_ERROR"
        });
    }
};
