const { Type } = require("@google/genai");
const joi = require("joi");
const {
    getAiClient,
    getModelName,
    executeWithTimeout,
    callGeminiWithRetry,
    extractJsonString,
    sanitizeSensitiveInfo
} = require("./aiService");

/**
 * Joi Schema for validating AI model structured output for listing descriptions.
 */
const aiListingOutputValidationSchema = joi.object({
    title: joi.string().trim().min(3).max(250).required(),
    description: joi.string().trim().min(10).max(6000).required(),
    summary: joi.string().trim().min(5).max(1200).required(),
    highlights: joi.array().items(joi.string().trim().min(2).max(400)).min(1).max(20).required()
}).required();

/**
 * Validates the parsed AI output against strict listing content requirements.
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
 * Generates an attractive listing title, comprehensive description,
 * concise summary, and bulleted highlights based strictly on host-provided details.
 * 
 * @param {object} details - Property details supplied by the host
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
            response = await callGeminiWithRetry(ai, {
                model: modelName,
                contents: userPrompt,
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: jsonSchema,
                    temperature: 0.6,
                    maxOutputTokens: 1500
                }
            }, 45000, 2);
        } catch (modelErr) {
            const isUnsupported = modelErr.status === 404 || (modelErr.message && modelErr.message.includes("no longer available"));
            if (isUnsupported && modelName !== "gemini-3.5-flash-lite") {
                console.warn(`Model ${modelName} is unavailable, retrying with gemini-3.5-flash-lite...`);
                modelName = "gemini-3.5-flash-lite";
                response = await callGeminiWithRetry(ai, {
                    model: modelName,
                    contents: userPrompt,
                    config: {
                        systemInstruction,
                        responseMimeType: "application/json",
                        responseSchema: jsonSchema,
                        temperature: 0.6,
                        maxOutputTokens: 1500
                    }
                }, 45000, 2);
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

        return validateAiListingOutput(parsed);

    } catch (err) {
        const sanitizedLog = sanitizeSensitiveInfo(err.message || String(err));
        console.error("Listing AI Service Error:", sanitizedLog);

        if (err.status && err.code) {
            err.message = sanitizeSensitiveInfo(err.message);
            throw err;
        }

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

module.exports = {
    generateListingContent,
    validateAiListingOutput
};
