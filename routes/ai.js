const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync.js");
const { isLoggedIn, aiRateLimiter, validateAiListing } = require("../middileware.js");
const aiController = require("../controllers/aiController.js");

// Root /ai redirects to the AI Tools Hub
router.get("/", (req, res) => {
    res.redirect("/ai/tools");
});

// AI Tools Overview Hub
router.get("/tools", aiController.renderToolsHub);

// FEATURE 1: AI Listing Description Generator
router.get(
    "/listing-generator",
    isLoggedIn,
    wrapAsync(aiController.renderListingGenerator)
);

router.post(
    "/generate-listing",
    isLoggedIn,
    aiRateLimiter,
    validateAiListing,
    wrapAsync(aiController.generateListing)
);

// FEATURE 2: AI Review Intelligence
router.get(
    "/review-insights",
    wrapAsync(aiController.renderAllReviewInsights)
);

router.get(
    "/review-insights/:id",
    wrapAsync(aiController.renderListingReviewInsights)
);

router.post(
    "/review-insights/:id/analyze",
    aiRateLimiter,
    wrapAsync(aiController.analyzeListingReviews)
);

// FEATURE 3: AI Natural-Language Search
router.get(
    "/search",
    wrapAsync(aiController.renderSearchPage)
);

router.post(
    "/search",
    aiRateLimiter,
    wrapAsync(aiController.executeNaturalSearch)
);

// Utility: AI Connectivity Status
router.get(
    "/status",
    isLoggedIn,
    wrapAsync(aiController.checkStatus)
);

module.exports = router;
