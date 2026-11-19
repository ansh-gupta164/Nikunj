// Ensure environment variables are loaded if this module is imported in isolation
if (!process.env.GEMINI_API_KEY) {
    require("dotenv").config();
}

const { GoogleGenAI, Type } = require("@google/genai");
const joi = require("joi");

/**
 * Joi Schema for validating AI model structured output.
 */
const aiListingOutputValidationSchema = joi.object({
    title: joi.string().trim().min(3).max(250).required(),
    description: joi.string().trim().min(10).max(6000).required(),
    summary: joi.string().trim().min(5).max(1200).required(),
    highlights: joi.array().items(joi.string().trim().min(2).max(400)).min(1).max(20).required()
}).required();

/**
 * Sanitizes any string to remove API keys or sensitive data from error logs/messages.
 * @param {string} text 
 * @returns {string} sanitized text
 */
function sanitizeSensitiveInfo(text) {
    if (!text || typeof text !== "string") {
        return "An error occurred with the AI service.";
    }
    let sanitized = text;
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey.length > 4) {
        sanitized = sanitized.split(apiKey).join("[REDACTED_API_KEY]");
    }
    // Redact key parameters in URLs if present
    sanitized = sanitized.replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]");
    return sanitized;
}

/**
 * Retrieves the configured Gemini API key, throwing a structured error if missing.
 * @returns {string}
 */
function getApiKey() {
    const key = process.env.GEMINI_API_KEY;
    if (!key || !key.trim()) {
        const error = new Error("AI service is not configured: GEMINI_API_KEY is missing on the server. Please add your GEMINI_API_KEY to the .env file and restart the server.");
        error.status = 503;
        error.code = "GEMINI_API_KEY_MISSING";
        throw error;
    }
    return key.trim();
}

/**
 * Retrieves the configured Gemini model name with fallback to a currently supported model.
 * Automatically updates legacy deprecated models (like gemini-2.5-flash / gemini-1.5-flash) to gemini-3.5-flash-lite.
 * @returns {string}
 */
function getModelName() {
    const configured = process.env.GEMINI_MODEL && process.env.GEMINI_MODEL.trim();
    if (!configured || configured === "gemini-2.5-flash" || configured === "gemini-1.5-flash" || configured === "gemini-1.0-pro" || configured === "gemini-2.0-flash") {
        return "gemini-3.5-flash";
    }
    return configured;
}

/**
 * Returns an instance of the GoogleGenAI client initialized with the server's API key.
 * @returns {GoogleGenAI}
 */
function getAiClient() {
    const apiKey = getApiKey();
    return new GoogleGenAI({
        apiKey,
        httpOptions: { timeout: 45000 }
    });
}

/**
 * Extracts and cleans JSON text from potential markdown formatting.
 * @param {string} raw 
 * @returns {string} cleaned JSON string
 */
function extractJsonString(raw) {
    if (!raw || typeof raw !== "string") {
        throw new Error("Received empty or non-string response from Gemini API.");
    }
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    }
    return cleaned;
}

/**
 * Executes an async operation with a hard timeout.
 * @param {Promise} promise 
 * @param {number} timeoutMs 
 * @returns {Promise}
 */
async function executeWithTimeout(promise, timeoutMs = 45000) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const error = new Error("AI request timed out. Please try again.");
            error.status = 504;
            error.code = "AI_TIMEOUT";
            reject(error);
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Executes a Gemini generateContent call with timeout and automatic retry on transient errors (503/504).
 * @param {GoogleGenAI} ai
 * @param {object} params
 * @param {number} timeoutMs
 * @param {number} maxRetries
 * @returns {Promise<any>}
 */
async function callGeminiWithRetry(ai, params, timeoutMs = 45000, maxRetries = 2) {
    let lastErr;
    let currentParams = { ...params };
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const generatePromise = ai.models.generateContent(currentParams);
            return await executeWithTimeout(generatePromise, timeoutMs);
        } catch (err) {
            lastErr = err;
            const isTransient = err.status === 503 || 
                                err.status === 504 || 
                                (err.message && (
                                    err.message.includes("DEADLINE_EXCEEDED") || 
                                    err.message.includes("high demand") || 
                                    err.message.includes("503") || 
                                    err.message.includes("504") ||
                                    err.message.includes("timed out")
                                ));
            if (isTransient && attempt < maxRetries) {
                if (currentParams.model !== "gemini-3.5-flash-lite") {
                    console.warn(`Primary model ${currentParams.model} encountered latency/deadline, switching to high-speed gemini-3.5-flash-lite...`);
                    currentParams.model = "gemini-3.5-flash-lite";
                }
                const backoffMs = 1000 * (attempt + 1);
                console.warn(`Transient Gemini issue, retrying in ${backoffMs}ms... (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, backoffMs));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

/**
 * Validates the parsed AI output against strict requirements.
 * @param {object} parsedData 
 * @returns {object} validated data
 */
function validateAiListingOutput(parsedData) {
    const { error, value } = aiListingOutputValidationSchema.validate(parsedData, {
        abortEarly: false,
        stripUnknown: true
    });

    if (error) {
        const validationError = new Error(
            `Malformed AI response: ${error.details.map(d => d.message).join(", ")}`
        );
        validationError.status = 502;
        validationError.code = "MALFORMED_AI_RESPONSE";
        throw validationError;
    }

    return value;
}

/**
 * Core function to generate listing title, description, summary, and highlights
 * using Google Gemini via the official @google/genai SDK.
 * 
 * @param {object} details - Property details supplied by the user
 * @returns {Promise<{ title: string, description: string, summary: string, highlights: string[] }>}
 */
async function generateListingContent(details) {
    const ai = getAiClient();
    let modelName = getModelName();

    // Format amenities
    let amenitiesList = [];
    if (Array.isArray(details.amenities)) {
        amenitiesList = details.amenities.map(a => String(a).trim()).filter(Boolean);
    } else if (typeof details.amenities === "string" && details.amenities.trim()) {
        amenitiesList = details.amenities
            .split(",")
            .map(a => a.trim())
            .filter(Boolean);
    }

    const bedroomsText = (details.bedrooms !== undefined && details.bedrooms !== null && details.bedrooms !== "")
        ? `${details.bedrooms} bedroom(s)`
        : "Not specified";

    const bathroomsText = (details.bathrooms !== undefined && details.bathrooms !== null && details.bathrooms !== "")
        ? `${details.bathrooms} bathroom(s)`
        : "Not specified";

    const priceText = (details.price !== undefined && details.price !== null && details.price !== "")
        ? `₹${details.price} per night`
        : "Not specified";

    const systemInstruction = 
`You are an expert real estate and hospitality copywriter for Nikunj AI, a premium stay booking platform.
Your objective is to generate accurate, attractive, professional, and well-structured listing content based ONLY and STRICTLY on the facts provided by the host.

ABSOLUTE GROUNDING CONSTRAINTS:
1. Base all generated text ONLY on the information explicitly provided.
2. NEVER invent amenities, facilities, views, attractions, distances (e.g. '10 minutes from beach'), or property specifications.
3. If an item or feature is not mentioned, DO NOT assume or add it.
4. If bedrooms, bathrooms, or price are 'Not specified', do not mention specific counts.
5. Use professional, warm, and natural English. Avoid repetitive hype words, excessive exclamation marks, or clickbait clichés.
6. Return strictly valid JSON adhering to the specified schema.`;

    const userPrompt = 
`Generate listing copy for the following property details:
- Property Title / Name: ${details.title ? String(details.title).trim() : "Not specified"}
- Property Type: ${details.propertyType ? String(details.propertyType).trim() : "Stay / Accommodation"}
- Location: ${details.location ? String(details.location).trim() : "Not specified"}
- Price: ${priceText}
- Bedrooms: ${bedroomsText}
- Bathrooms: ${bathroomsText}
- Verified Amenities & Facilities: ${amenitiesList.length > 0 ? amenitiesList.join(", ") : "None specified"}
- Host's Additional Information / Notes: ${details.additionalInfo ? String(details.additionalInfo).trim() : "None"}

Generate:
1. title: An attractive, professional listing title (under 100 characters).
2. description: A comprehensive, engaging property description (2-3 structured paragraphs) based strictly on the verified details.
3. summary: A concise 1-2 sentence overview summarizing the stay.
4. highlights: A list of 3-6 distinct bullet points emphasizing key features from the provided facts.`;

    const jsonSchema = {
        type: Type.OBJECT,
        properties: {
            title: {
                type: Type.STRING,
                description: "An attractive, professional listing title based ONLY on provided details."
            },
            description: {
                type: Type.STRING,
                description: "A comprehensive, professional property description."
            },
            summary: {
                type: Type.STRING,
                description: "A concise 1-2 sentence overview of the property."
            },
            highlights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of 3-6 key highlights strictly derived from user-provided facts."
            }
        },
        required: ["title", "description", "summary", "highlights"]
    };

    try {
        let response;
        try {
            const generatePromise = ai.models.generateContent({
                model: modelName,
                contents: userPrompt,
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: jsonSchema,
                    temperature: 0.6,
                    maxOutputTokens: 1500
                }
            });
            response = await executeWithTimeout(generatePromise, 25000);
        } catch (modelErr) {
            // If the model is retired/not found (404), seamlessly fallback to gemini-3.5-flash
            const isUnsupported = modelErr.status === 404 || (modelErr.message && modelErr.message.includes("no longer available"));
            if (isUnsupported && modelName !== "gemini-3.5-flash") {
                console.warn(`Model ${modelName} is unavailable, retrying with gemini-3.5-flash...`);
                modelName = "gemini-3.5-flash";
                const fallbackPromise = ai.models.generateContent({
                    model: modelName,
                    contents: userPrompt,
                    config: {
                        systemInstruction,
                        responseMimeType: "application/json",
                        responseSchema: jsonSchema,
                        temperature: 0.6,
                        maxOutputTokens: 1500
                    }
                });
                response = await executeWithTimeout(fallbackPromise, 25000);
            } else {
                throw modelErr;
            }
        }

        const rawText = typeof response.text === "function" ? response.text() : response.text;
        if (!rawText || !rawText.trim()) {
            const emptyError = new Error("AI service returned an empty response.");
            emptyError.status = 502;
            emptyError.code = "EMPTY_AI_RESPONSE";
            throw emptyError;
        }

        let parsed;
        try {
            const cleaned = extractJsonString(rawText);
            parsed = JSON.parse(cleaned);
        } catch (jsonErr) {
            const parseError = new Error("Failed to parse JSON response from AI service.");
            parseError.status = 502;
            parseError.code = "MALFORMED_AI_RESPONSE";
            throw parseError;
        }

        // Validate structure before returning to controller
        const validatedResult = validateAiListingOutput(parsed);
        return validatedResult;

    } catch (err) {
        // Detailed server-side logging (sanitized)
        const sanitizedLog = sanitizeSensitiveInfo(err.message || String(err));
        console.error("AI Service Error:", sanitizedLog);

        // If error already has a known status, rethrow sanitized
        if (err.status && err.code) {
            err.message = sanitizeSensitiveInfo(err.message);
            throw err;
        }

        // Map external SDK error states to secure client errors
        const errMsg = (err.message || "").toLowerCase();
        const mappedError = new Error();

        if (errMsg.includes("api_key_invalid") || errMsg.includes("invalid api key") || errMsg.includes("unauthenticated") || err.status === 401) {
            mappedError.status = 401;
            mappedError.code = "AI_AUTH_FAILED";
            mappedError.message = "Authentication with AI service failed. Please check your GEMINI_API_KEY in .env.";
        } else if (errMsg.includes("resource_exhausted") || errMsg.includes("quota") || errMsg.includes("rate limit") || err.status === 429) {
            mappedError.status = 429;
            mappedError.code = "AI_RATE_LIMIT";
            mappedError.message = "AI service rate limit or quota exceeded. Please try again shortly.";
        } else if (errMsg.includes("unavailable") || errMsg.includes("503") || errMsg.includes("high demand")) {
            mappedError.status = 503;
            mappedError.code = "AI_UNAVAILABLE";
            mappedError.message = "AI service is currently busy. Please try again in a few moments.";
        } else if (err.code === "AI_TIMEOUT" || errMsg.includes("timeout") || errMsg.includes("deadline")) {
            mappedError.status = 504;
            mappedError.code = "AI_TIMEOUT";
            mappedError.message = "AI generation request timed out. Please try again.";
        } else {
            mappedError.status = 500;
            mappedError.code = "AI_INTERNAL_ERROR";
            mappedError.message = "An error occurred while generating listing content. Please try again.";
        }

        throw mappedError;
    }
}

/**
 * Verifies connectivity with Gemini API.
 * Returns { success: true, model: string, status: string } or throws sanitized error.
 */
async function testConnection() {
    let modelName = getModelName();
    const ai = getAiClient();

    let response;
    try {
        const pingPromise = ai.models.generateContent({
            model: modelName,
            contents: "Respond with the word 'OK' if you are online."
        });
        response = await executeWithTimeout(pingPromise, 20000);
    } catch (err) {
        if ((err.status === 404 || (err.message && err.message.includes("no longer available"))) && modelName !== "gemini-3.5-flash") {
            modelName = "gemini-3.5-flash";
            const retryPromise = ai.models.generateContent({
                model: modelName,
                contents: "Respond with the word 'OK' if you are online."
            });
            response = await executeWithTimeout(retryPromise, 20000);
        } else {
            throw err;
        }
    }

    const text = typeof response.text === "function" ? response.text() : response.text;
    return {
        success: true,
        model: modelName,
        status: text ? "connected" : "unknown"
    };
}

/**
 * Returns safe diagnostics without exposing any secret keys.
 */
function checkConfiguration() {
    const key = process.env.GEMINI_API_KEY;
    return {
        available: Boolean(key && key.trim()),
        model: getModelName()
    };
}

module.exports = {
    generateListingContent,
    validateAiListingOutput,
    testConnection,
    sanitizeSensitiveInfo,
    getApiKey,
    getModelName,
    getAiClient,
    checkConfiguration,
    executeWithTimeout,
    callGeminiWithRetry,
    extractJsonString
};
