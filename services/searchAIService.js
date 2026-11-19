const { Type } = require("@google/genai");
const joi = require("joi");
const Listing = require("../models/listing");
require("../models/user"); // Ensure User model is registered for populate('owner')
require("../models/review"); // Ensure Review model is registered for populate('reviews')
const {
    getAiClient,
    getModelName,
    executeWithTimeout,
    callGeminiWithRetry,
    extractJsonString,
    sanitizeSensitiveInfo
} = require("./aiService");

/**
 * Joi Schema for validating natural language search interpretation from Gemini.
 */
const searchInterpretationSchema = joi.object({
    location: joi.string().trim().max(100).allow(null, ""),
    minPrice: joi.number().min(0).max(100000000).allow(null),
    maxPrice: joi.number().min(0).max(100000000).allow(null),
    propertyType: joi.string().trim().max(50).allow(null, ""),
    keywords: joi.array().items(joi.string().trim().max(60)).max(10).default([]),
    intentSummary: joi.string().trim().max(300).required(),
    unsupportedFilters: joi.array().items(joi.string().trim().max(100)).default([])
}).required();

/**
 * Escapes special characters for safe regular expression matching.
 * Prevents ReDoS and regex injection.
 * @param {string} string 
 * @returns {string} escaped regex string
 */
function escapeRegex(string) {
    if (!string || typeof string !== "string") return "";
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Interprets a user's freeform natural language search query using Gemini AI.
 * 
 * @param {string} userQuery - Natural language query from search bar
 * @returns {Promise<object>} Structured interpretation parameters
 */
async function interpretSearchQuery(userQuery) {
    if (!userQuery || typeof userQuery !== "string" || !userQuery.trim()) {
        return {
            location: null,
            minPrice: null,
            maxPrice: null,
            propertyType: null,
            keywords: [],
            intentSummary: "All available listings",
            unsupportedFilters: []
        };
    }

    const ai = getAiClient();
    let modelName = getModelName();

    const systemInstruction = 
`You are an expert search intent parser for Nikunj AI, a stay booking platform.
Your task is to parse a user's natural language search prompt into structured search parameters.

The database schema ONLY supports the following fields:
- location: City or region string (e.g. "Goa", "Manali", "Indore", "Mumbai")
- price: Price per night in Indian Rupees (INR)
- title & description: Property text containing keywords (e.g. "peaceful", "pool", "lake", "chalet", "villa")
- country: Country name

CRITICAL RULES:
1. Extract location if mentioned.
2. Extract numeric budget constraints:
   - "under 10000" or "below 5000" -> maxPrice: 10000 or 5000.
   - "above 3000" or "at least 4000" -> minPrice: 3000 or 4000.
   - "between 3000 and 7000" -> minPrice: 3000, maxPrice: 7000.
   - "cheap" or "affordable" without numbers -> maxPrice: 4000.
   - "luxury" or "premium" without numbers -> minPrice: 7000.
3. Extract core descriptive keywords (e.g., ["peaceful", "pool", "villa"]).
4. If the user mentions attributes NOT stored in our database (e.g. "ev charging", "private chef", "pet grooming"), list them in unsupportedFilters.
5. Provide a 1-sentence friendly intentSummary explaining what the user is looking for.
6. Strictly output valid JSON matching the requested schema.`;

    const userPrompt = `Parse this search query into structured search filters: "${userQuery.trim().substring(0, 300)}"`;

    const jsonSchema = {
        type: Type.OBJECT,
        properties: {
            location: {
                type: Type.STRING,
                description: "Target destination, city, or state name, or null if none mentioned."
            },
            minPrice: {
                type: Type.NUMBER,
                description: "Minimum price per night in INR, or null."
            },
            maxPrice: {
                type: Type.NUMBER,
                description: "Maximum price per night in INR, or null."
            },
            propertyType: {
                type: Type.STRING,
                description: "Stay type (e.g. 'Villa', 'Apartment', 'Cottage'), or null."
            },
            keywords: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Important descriptive keywords to look for in title or description."
            },
            intentSummary: {
                type: Type.STRING,
                description: "A concise 1-sentence summary of what the user is searching for."
            },
            unsupportedFilters: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Any filters requested that are not directly supported by the database schema."
            }
        },
        required: ["intentSummary", "keywords", "unsupportedFilters"]
    };

    try {
        let response;
        try {
            response = await callGeminiWithRetry(ai, {
                model: modelName,
                contents: userPrompt,
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: jsonSchema,
                    temperature: 0.2, // Low temperature for consistent deterministic parsing
                    maxOutputTokens: 600
                }
            }, 30000, 2);
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
                        temperature: 0.2,
                        maxOutputTokens: 600
                    }
                }, 30000, 2);
            } else {
                throw modelErr;
            }
        }

        const rawText = typeof response.text === "function" ? response.text() : response.text;
        const cleaned = extractJsonString(rawText);
        const parsed = JSON.parse(cleaned);

        const { error, value } = searchInterpretationSchema.validate(parsed, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            throw new Error(`Search parsing validation failed: ${error.message}`);
        }

        return value;

    } catch (err) {
        console.warn("AI search parsing error, falling back to heuristic parsing:", sanitizeSensitiveInfo(err.message));
        // Graceful heuristic fallback if Gemini is offline
        const cleanQuery = userQuery.trim();
        const priceMatch = cleanQuery.match(/(?:under|below|less than|max)\s*(?:rs\.?|inr|₹)?\s*(\d+)/i);
        const maxPrice = priceMatch ? Number(priceMatch[1]) : null;

        return {
            location: cleanQuery.split(" ")[0] || null,
            minPrice: null,
            maxPrice: maxPrice,
            propertyType: null,
            keywords: cleanQuery.split(/\s+/).filter(w => w.length > 3),
            intentSummary: `Searched for "${cleanQuery}"`,
            unsupportedFilters: []
        };
    }
}

/**
 * Builds a strictly safe Mongoose query condition object from validated search parameters.
 * Prevents arbitrary MongoDB operators or raw scripts.
 * 
 * @param {object} params - Validated search parameters
 * @returns {object} Safe Mongoose query filter
 */
function buildSafeMongooseQuery(params) {
    const query = {};

    // 1. Location match
    if (params.location && params.location.trim()) {
        const safeLoc = escapeRegex(params.location.trim());
        query.$or = [
            { location: { $regex: safeLoc, $options: "i" } },
            { country: { $regex: safeLoc, $options: "i" } }
        ];
    }

    // 2. Price boundary filters
    if (params.minPrice !== null || params.maxPrice !== null) {
        query.price = {};
        if (params.minPrice !== null && !isNaN(params.minPrice)) {
            query.price.$gte = Number(params.minPrice);
        }
        if (params.maxPrice !== null && !isNaN(params.maxPrice)) {
            query.price.$lte = Number(params.maxPrice);
        }
    }

    // 3. Keyword / Property Type text matching
    const searchTerms = [];
    if (params.propertyType && params.propertyType.trim()) {
        searchTerms.push(params.propertyType.trim());
    }
    if (Array.isArray(params.keywords)) {
        params.keywords.forEach(kw => {
            if (kw && kw.trim() && kw.length > 2) {
                searchTerms.push(kw.trim());
            }
        });
    }

    if (searchTerms.length > 0) {
        const termConditions = searchTerms.map(term => {
            const safeTerm = escapeRegex(term);
            return {
                $or: [
                    { title: { $regex: safeTerm, $options: "i" } },
                    { description: { $regex: safeTerm, $options: "i" } },
                    { location: { $regex: safeTerm, $options: "i" } }
                ]
            };
        });

        if (query.$or) {
            // Combine with existing location $or
            query.$and = [{ $or: query.$or }, { $or: termConditions }];
            delete query.$or;
        } else {
            query.$or = termConditions;
        }
    }

    return query;
}

/**
 * Evaluates a listing against user search parameters and returns matching reasons.
 * 
 * @param {object} listing - Listing document
 * @param {object} params - Validated search parameters
 * @returns {Array<string>} List of match rationales
 */
function evaluateMatchRationale(listing, params) {
    const reasons = [];

    if (params.location && listing.location && listing.location.toLowerCase().includes(params.location.toLowerCase())) {
        reasons.push(`Destination: Located in ${listing.location}`);
    }

    if (params.maxPrice !== null && listing.price <= params.maxPrice) {
        reasons.push(`Budget: ₹${listing.price.toLocaleString("en-IN")} is within your max ₹${params.maxPrice.toLocaleString("en-IN")}`);
    }

    if (params.minPrice !== null && listing.price >= params.minPrice) {
        reasons.push(`Price: ₹${listing.price.toLocaleString("en-IN")}/night matches your minimum filter`);
    }

    const listingText = `${listing.title} ${listing.description || ""}`.toLowerCase();
    if (Array.isArray(params.keywords)) {
        const matchedKw = params.keywords.filter(kw => listingText.includes(kw.toLowerCase()));
        if (matchedKw.length > 0) {
            reasons.push(`Matches features: ${matchedKw.join(", ")}`);
        }
    }

    if (reasons.length === 0) {
        reasons.push("Recommended stay based on overall destination proximity");
    }

    return reasons;
}

/**
 * Executes an end-to-end AI natural language search against MongoDB listings.
 * 
 * @param {string} rawQuery - Natural language query
 * @returns {Promise<{ interpretation: object, listings: Array<object>, totalCount: number }>}
 */
async function searchListingsWithAI(rawQuery) {
    const interpretation = await interpretSearchQuery(rawQuery);
    const mongooseQuery = buildSafeMongooseQuery(interpretation);

    let listings = await Listing.find(mongooseQuery).populate("owner");

    // If initial query was overly restrictive, attempt a relaxed search (e.g. location only)
    let isRelaxed = false;
    if (listings.length === 0 && interpretation.location) {
        const relaxedQuery = {
            $or: [
                { location: { $regex: escapeRegex(interpretation.location), $options: "i" } },
                { country: { $regex: escapeRegex(interpretation.location), $options: "i" } }
            ]
        };
        listings = await Listing.find(relaxedQuery).populate("owner");
        if (listings.length > 0) {
            isRelaxed = true;
        }
    }

    // Attach match explanations to each listing
    const enrichedListings = listings.map(listing => {
        const doc = listing.toObject ? listing.toObject() : { ...listing };
        doc.matchReasons = evaluateMatchRationale(doc, interpretation);
        return doc;
    });

    return {
        query: rawQuery,
        interpretation,
        isRelaxed,
        totalCount: enrichedListings.length,
        listings: enrichedListings
    };
}

module.exports = {
    interpretSearchQuery,
    buildSafeMongooseQuery,
    evaluateMatchRationale,
    searchListingsWithAI,
    escapeRegex
};
