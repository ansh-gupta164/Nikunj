const { Type } = require("@google/genai");
const joi = require("joi");
const Listing = require("../models/listing");
require("../models/user");
require("../models/review");
const {
    getAiClient,
    getModelName,
    executeWithTimeout,
    callGeminiWithRetry,
    extractJsonString,
    sanitizeSensitiveInfo
} = require("./aiService");

// In-flight request de-duplication cache
const inFlightAnalyses = new Map();

/**
 * Joi Schema for validating AI Review Analyzer structured output.
 */
const reviewAnalysisSchema = joi.object({
    overallSummary: joi.string().trim().min(5).max(3000).required(),
    positivePoints: joi.array().items(joi.string().trim().max(300)).max(15).required(),
    negativePoints: joi.array().items(joi.string().trim().max(300)).max(15).required(),
    commonComplaints: joi.array().items(joi.string().trim().max(300)).max(15).required(),
    frequentlyAppreciated: joi.array().items(joi.string().trim().max(300)).max(15).required(),
    sentiment: joi.string().valid(
        "Positive",
        "Mostly Positive",
        "Mixed",
        "Neutral",
        "Mostly Negative",
        "Negative",
        "Insufficient Data"
    ).required()
}).required();

/**
 * Sanitizes user review comments to neutralize potential prompt injections.
 * @param {string} text 
 * @returns {string} cleaned review text
 */
function sanitizeReviewForPrompt(text) {
    if (!text || typeof text !== "string") return "";
    let clean = text.replace(/[\r\n\t]+/g, " ").trim();
    // Neutralize common prompt injection trigger patterns
    clean = clean.replace(/ignore\s+(all\s+)?(previous\s+)?instructions/gi, "[filtered]");
    clean = clean.replace(/system\s+prompt/gi, "[filtered]");
    clean = clean.replace(/you\s+are\s+now/gi, "[filtered]");
    clean = clean.replace(/```/g, "'''");
    // Truncate individual review comment to sensible limit
    if (clean.length > 500) {
        clean = clean.substring(0, 500) + "...";
    }
    return clean;
}

/**
 * Validates the parsed AI review output against strict schema rules.
 * @param {object} parsedData 
 * @returns {object} validated data
 */
function validateReviewAnalysisOutput(parsedData) {
    const { error, value } = reviewAnalysisSchema.validate(parsedData, {
        abortEarly: false,
        stripUnknown: true
    });

    if (error) {
        const validationError = new Error(
            `Malformed AI review analysis: ${error.details.map(d => d.message).join(", ")}`
        );
        validationError.status = 502;
        validationError.code = "MALFORMED_AI_RESPONSE";
        throw validationError;
    }

    return value;
}

/**
 * Analyzes reviews for a listing using Gemini AI with smart caching.
 * 
 * @param {string|ObjectId} listingId - The listing's ID
 * @param {boolean} forceRefresh - Whether to bypass cache and regenerate
 * @returns {Promise<object>} Structured review insights
 */
async function analyzeListingReviews(listingId, forceRefresh = false) {
    const listing = await Listing.findById(listingId).populate("reviews");
    if (!listing) {
        const notFound = new Error("Listing not found.");
        notFound.status = 404;
        throw notFound;
    }

    const reviews = listing.reviews || [];
    const currentReviewCount = reviews.length;

    // Zero-review handling
    if (currentReviewCount === 0) {
        return {
            overallSummary: "No guest reviews have been submitted for this property yet.",
            positivePoints: [],
            negativePoints: [],
            commonComplaints: [],
            frequentlyAppreciated: [],
            sentiment: "Insufficient Data",
            reviewsAnalyzedCount: 0,
            lastAnalyzedAt: new Date(),
            isCached: false,
            status: "no_reviews"
        };
    }

    // Cache hit verification
    const existingCache = listing.aiReviewSummary;
    const isCacheFresh = 
        existingCache &&
        existingCache.overallSummary &&
        existingCache.reviewsAnalyzedCount === currentReviewCount &&
        existingCache.lastAnalyzedAt;

    if (!forceRefresh && isCacheFresh) {
        return {
            overallSummary: existingCache.overallSummary,
            positivePoints: existingCache.positivePoints || [],
            negativePoints: existingCache.negativePoints || [],
            commonComplaints: existingCache.commonComplaints || [],
            frequentlyAppreciated: existingCache.frequentlyAppreciated || [],
            sentiment: existingCache.sentiment || "Neutral",
            reviewsAnalyzedCount: existingCache.reviewsAnalyzedCount,
            lastAnalyzedAt: existingCache.lastAnalyzedAt,
            isCached: true,
            status: "cached"
        };
    }

    // In-flight de-duplication: avoid multiple simultaneous requests for same listing
    const cacheKey = String(listingId);
    if (inFlightAnalyses.has(cacheKey)) {
        return await inFlightAnalyses.get(cacheKey);
    }

    const analysisPromise = (async () => {
        try {
            const ai = getAiClient();
            let modelName = getModelName();

            // Prepare review items without exposing personal user details
            const reviewExcerpts = reviews.slice(0, 35).map((r, idx) => {
                const rating = r.rating || 5;
                const cleanComment = sanitizeReviewForPrompt(r.comment);
                return `Review ${idx + 1}: [Rating: ${rating}/5 stars] "${cleanComment}"`;
            });

            const systemInstruction = 
`You are an objective customer experience and hospitality data analyst for Nikunj AI.
Your objective is to analyze verified guest reviews for a stay listing and extract structured sentiment intelligence.

CRITICAL GROUNDING RULES:
1. Base your summary, positive points, negative points, and complaints ONLY on the actual guest reviews provided.
2. NEVER invent customer feedback, praise, or complaints not mentioned in the reviews.
3. If reviews are entirely positive, keep negativePoints and commonComplaints empty or minimal.
4. If there are few or single reviews, note that feedback is based on limited reviews.
5. Accurately assign the overall sentiment: "Positive", "Mostly Positive", "Mixed", "Neutral", "Mostly Negative", "Negative", or "Insufficient Data".
6. Strictly return valid JSON matching the specified schema.`;

            const userPrompt = 
`Analyze the following ${reviewExcerpts.length} guest reviews for "${listing.title}" located in "${listing.location}":

${reviewExcerpts.join("\n\n")}

Provide structured analysis in JSON:
1. overallSummary: 2-3 sentences synthesizing general customer impressions.
2. positivePoints: 2-5 distinct bullet points of praised aspects.
3. negativePoints: 0-4 distinct bullet points of shortcomings or guest concerns.
4. commonComplaints: 0-3 recurring complaints (empty array if none reported).
5. frequentlyAppreciated: 2-5 features or services frequently praised.
6. sentiment: One of ["Positive", "Mostly Positive", "Mixed", "Neutral", "Mostly Negative", "Negative"].`;

            const jsonSchema = {
                type: Type.OBJECT,
                properties: {
                    overallSummary: {
                        type: Type.STRING,
                        description: "2-3 sentences synthesizing overall customer sentiment based only on actual reviews."
                    },
                    positivePoints: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "List of top positive aspects praised by guests."
                    },
                    negativePoints: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "List of shortcomings or complaints mentioned by guests."
                    },
                    commonComplaints: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "Recurring issues reported by guests."
                    },
                    frequentlyAppreciated: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "Features, hospitality, or amenities repeatedly praised."
                    },
                    sentiment: {
                        type: Type.STRING,
                        enum: [
                            "Positive",
                            "Mostly Positive",
                            "Mixed",
                            "Neutral",
                            "Mostly Negative",
                            "Negative",
                            "Insufficient Data"
                        ],
                        description: "Overall sentiment classification."
                    }
                },
                required: [
                    "overallSummary",
                    "positivePoints",
                    "negativePoints",
                    "commonComplaints",
                    "frequentlyAppreciated",
                    "sentiment"
                ]
            };

            let response;
            try {
                response = await callGeminiWithRetry(ai, {
                    model: modelName,
                    contents: userPrompt,
                    config: {
                        systemInstruction,
                        responseMimeType: "application/json",
                        responseSchema: jsonSchema,
                        temperature: 0.3, // Lower temperature for analytical precision
                        maxOutputTokens: 1200
                    }
                }, 45000, 2);
            } catch (modelErr) {
                if (modelErr.status === 404 && modelName !== "gemini-3.5-flash-lite") {
                    modelName = "gemini-3.5-flash-lite";
                    response = await callGeminiWithRetry(ai, {
                        model: modelName,
                        contents: userPrompt,
                        config: {
                            systemInstruction,
                            responseMimeType: "application/json",
                            responseSchema: jsonSchema,
                            temperature: 0.3,
                            maxOutputTokens: 1200
                        }
                    }, 45000, 2);
                } else {
                    throw modelErr;
                }
            }

            const rawText = typeof response.text === "function" ? response.text() : response.text;
            if (!rawText || !rawText.trim()) {
                throw new Error("AI service returned empty response for review analysis.");
            }

            const cleaned = extractJsonString(rawText);
            const parsed = JSON.parse(cleaned);
            const validated = validateReviewAnalysisOutput(parsed);

            // Persist the fresh analysis into MongoDB cache
            const updatedCache = {
                overallSummary: validated.overallSummary,
                positivePoints: validated.positivePoints,
                negativePoints: validated.negativePoints,
                commonComplaints: validated.commonComplaints,
                frequentlyAppreciated: validated.frequentlyAppreciated,
                sentiment: validated.sentiment,
                reviewsAnalyzedCount: currentReviewCount,
                lastAnalyzedAt: new Date()
            };

            await Listing.findByIdAndUpdate(listingId, {
                aiReviewSummary: updatedCache
            });

            return {
                ...updatedCache,
                isCached: false,
                status: "freshly_generated"
            };

        } catch (err) {
            console.error("Review AI Service Error:", sanitizeSensitiveInfo(err.message || String(err)));
            // Graceful degradation: If Gemini fails but a previous cache exists, return previous cache!
            if (existingCache && existingCache.overallSummary) {
                console.warn("Returning previous cached review summary due to API failure.");
                return {
                    overallSummary: existingCache.overallSummary,
                    positivePoints: existingCache.positivePoints || [],
                    negativePoints: existingCache.negativePoints || [],
                    commonComplaints: existingCache.commonComplaints || [],
                    frequentlyAppreciated: existingCache.frequentlyAppreciated || [],
                    sentiment: existingCache.sentiment || "Neutral",
                    reviewsAnalyzedCount: existingCache.reviewsAnalyzedCount,
                    lastAnalyzedAt: existingCache.lastAnalyzedAt,
                    isCached: true,
                    status: "fallback_cached",
                    warning: "AI service currently unavailable; showing latest cached insights."
                };
            }
            throw err;
        } finally {
            inFlightAnalyses.delete(cacheKey);
        }
    })();

    inFlightAnalyses.set(cacheKey, analysisPromise);
    return await analysisPromise;
}

module.exports = {
    analyzeListingReviews,
    sanitizeReviewForPrompt,
    validateReviewAnalysisOutput
};
