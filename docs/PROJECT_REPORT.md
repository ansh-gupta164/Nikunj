# NIKUNJ AI: Generative AI-Powered Listing & Review Intelligence Platform

## Academic Mini-Project Report
**Degree:** Bachelor of Technology / Bachelor of Engineering  
**Department:** Computer Science & Engineering / Information Technology  
**Academic Semester:** Seventh Semester / Final Year  
**Course Specialization:** Generative Artificial Intelligence & Cloud Computing  

---

## Abstract

In the modern digital hospitality industry, platforms such as Airbnb, Vrbo, and Booking.com serve millions of hosts and guests daily. However, existing platforms present significant operational friction: property owners struggle to craft compelling, accurate property descriptions; prospective guests suffer from review fatigue when parsing hundreds of unstructured text reviews; and rigid keyword-based search engines fail to understand nuanced natural language queries.

This project introduces **Nikunj AI**, a full-stack web application that transforms a traditional vacation rental platform into a Generative AI-driven hospitality platform using Google’s Gemini Large Language Model (`gemini-3.5-flash`), Node.js, Express.js, MongoDB Atlas, and EJS. 

Nikunj AI implements three primary AI capabilities:
1. **AI Listing Description Generator**: An automated copywriting assistant that produces marketing-ready titles, comprehensive descriptions, concise summaries, and bulleted highlights while strictly preventing hallucinations through rigid grounding rules.
2. **AI Review Analyzer & Intelligent Caching**: A sentiment intelligence pipeline that digests unstructured guest reviews, classifies sentiment, extracts key positive highlights and recurring complaints, and persists results directly into MongoDB Atlas with automated invalidation policies to eliminate redundant LLM API costs.
3. **AI Natural Language Search Engine**: A semantic search pipeline that parses conversational search queries (e.g., *"Peaceful cottage in Manali under 4000 with wifi"*) into structured database parameters, which are compiled by a safe backend Mongoose query builder into strictly sanitized database operations, preventing NoSQL injection.

The platform retains strict enterprise software engineering standards, including MVC architecture, Passport.js session security, Joi schema validation, exponential backoff retries, rate-limiting, and key redaction. Comprehensive unit, integration, and live end-to-end testing demonstrated 100% test pass rates across 30 test cases, achieving sub-second cached response times and zero API key exposure.

---

## Chapter 1: Introduction

### 1.1 Background
The sharing economy has democratized vacation rentals and homestays. Platforms allow independent property owners (hosts) to list accommodations and guests to discover stays. While the core CRUD (Create, Read, Update, Delete) paradigm suffices for basic inventory management, it fails to address semantic complexity. Unstructured natural language dominates host-guest interactions—from property descriptions to post-stay guest feedback.

### 1.2 Problem Statement
1. **Host Copywriting Bottleneck**: Independent hosts frequently lack marketing copywriting expertise. Poorly described properties result in lower conversion rates.
2. **Review Fatigue**: High-traffic listings accumulate hundreds of reviews. Prospective travelers spend excessive time sifting through comments to ascertain basic hygiene factors (e.g., cleanliness, Wi-Fi speed, water pressure).
3. **Rigid Search Paradigms**: Traditional database queries depend on exact substring matches (e.g., `location: /Goa/i`). Conversational queries expressing compound criteria, budget boundaries, and atmospheric preferences fail.
4. **AI Hallucination & Security Risks**: Naive integrations of LLMs introduce severe vulnerabilities: LLMs hallucinating amenities not present, prompt injection attacks through malicious guest reviews, and NoSQL injection through unchecked model queries.

### 1.3 Project Objectives
- Upgrade an existing full-stack monolithic Node.js/Express application into an enterprise-grade AI-powered platform.
- Integrate Google’s official `@google/genai` SDK using server-side service encapsulation.
- Enforce strict JSON schema validation for all LLM outputs.
- Implement an embedded caching layer in MongoDB to minimize API costs and optimize latency.
- Protect database integrity using a deterministic Mongoose query compiler rather than executing raw LLM code.
- Maintain 100% backward compatibility with existing Passport.js authentication, Cloudinary image uploads, and EJS views.

---

## Chapter 2: Literature Review & Comparative Analysis

### 2.1 Evolution of Natural Language Processing in Hospitality
Early sentiment analysis relied on lexicon-based approaches (e.g., VADER, SentiWordNet) and classical machine learning (Naive Bayes, Support Vector Machines). While computationally lightweight, these methods failed to capture context, sarcasm, and domain-specific nuances.

With the advent of Transformer architectures (Vaswani et al., 2017) and Foundation Models like Google Gemini and OpenAI GPT-4, models exhibit emergent reasoning capabilities. Google Gemini 3.5 Flash provides high computational efficiency and native structured JSON outputs, making real-time web application integration commercially and technically feasible.

### 2.2 Comparative Matrix

| Feature / Dimension | Traditional Vacation Rental | Naive AI Integration | Nikunj AI Platform |
|---|---|---|---|
| **Listing Creation** | Manual text input by host | Unconstrained LLM text generation (prone to hallucination) | Grounded LLM generation with Joi schema verification |
| **Review Processing** | Unsorted chronological text comments | Raw prompt without injection defense | Delimited, sanitized prompt with structured sentiment JSON |
| **Review Storage** | Relational / Document reviews collection | LLM queried on every page load | MongoDB embedded cache with review count & TTL invalidation |
| **Search Engine** | Exact keyword SQL / Regex matches | LLM writes raw database query (High Security Risk) | Two-stage Intent Extraction + Deterministic Mongoose Compiler |
| **Architecture** | Standard MVC | Disorganized API calls in routes/controllers | Modular AI Service Layer (`services/`) with timeout & retry guards |

---

## Chapter 3: System Architecture & Engineering Design

### 3.1 Architectural Overview
Nikunj AI adopts an extended **Model-View-Controller (MVC) + AI Service Layer** architecture.

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Browser                        │
│         EJS Templates + Bootstrap 5 + AJAX (Fetch)          │
└──────────────────────────────▲──────────────────────────────┘
                               │ HTTP / JSON
┌──────────────────────────────▼──────────────────────────────┐
│                  Express.js Application                     │
│  - Passport Session Auth     - Joi Input Validation         │
│  - Express-Rate-Limit        - Helmet & Flash Notifications │
├──────────────────────────────┬──────────────────────────────┤
│      Standard Controllers    │         AI Controller        │
│  (listings, reviews, users)  │       (aiController.js)      │
└──────────────┬───────────────┴──────────────┬───────────────┘
               │                              │
┌──────────────▼───────────────┐ ┌────────────▼───────────────┐
│     Mongoose ORM Layer       │ │      AI Service Layer      │
│  - Listing (with AI cache)   │ │  - aiService (core client) │
│  - Review                    │ │  - listingAIService        │
│  - User                      │ │  - reviewAIService         │
│                              │ │  - searchAIService         │
└──────────────┬───────────────┘ └────────────┬───────────────┘
               │                              │
┌──────────────▼───────────────┐ ┌────────────▼───────────────┐
│     MongoDB Atlas (Cloud)    │ │     Google GenAI Cloud     │
│       Database Cluster       │ │    (Gemini 3.5 Flash)      │
└──────────────────────────────┘ └────────────────────────────┘
```

### 3.2 Database Schema Enhancements
To achieve cost-effective review intelligence without degrading read performance, the `Listing` schema was extended with an embedded subdocument:

```javascript
aiReviewSummary: {
    overallSummary: { type: String, default: null },
    positivePoints: [{ type: String }],
    negativePoints: [{ type: String }],
    commonComplaints: [{ type: String }],
    frequentlyAppreciated: [{ type: String }],
    sentiment: { 
        type: String, 
        enum: ["Positive", "Mostly Positive", "Mixed", "Neutral", "Mostly Negative", "Negative", "Insufficient Data", null],
        default: null 
    },
    lastAnalyzedAt: { type: Date, default: null },
    reviewsAnalyzedCount: { type: Number, default: 0 }
}
```

---

## Chapter 4: Generative AI Implementation Details

### 4.1 Feature 1: AI Listing Description Generator
- **User Inputs**: Property title, property type (Villa, Apartment, Haveli, etc.), location, price per night, bedrooms, bathrooms, amenities list, and additional notes.
- **Prompt Engineering**:
  - Uses `systemInstruction` defining persona and explicit negative constraints.
  - User inputs are injected with clear key-value structures.
- **Hallucination Prevention**:
  The system instruction explicitly mandates: *"Base your content ONLY on the property details provided. NEVER invent amenities, nearby attractions, or services not provided by the user."*
- **Structured Output**:
  Configured with `responseMimeType: "application/json"` and `responseSchema` defining `title`, `description`, `summary`, and `highlights`.
- **Validation**:
  Passed through `validateAiListingOutput` using Joi.

### 4.2 Feature 2: AI Review Analyzer & Caching Pipeline
- **Input Sanitization**:
  Customer reviews are sanitized via `sanitizeReviewForPrompt` to neutralize prompt injection phrases (`ignore previous instructions`, `you are now`, `system prompt:`).
- **Prompt Isolation**:
  Reviews are delimited as distinct numbered records: `Review 1: [Rating: 5/5 stars] "Great host and clean rooms"`.
- **Intelligence Extraction**:
  The model synthesizes customer sentiment, extracting:
  - `overallSummary`: 2-3 sentence executive summary.
  - `positivePoints`: Praised features.
  - `negativePoints`: Shortcomings.
  - `commonComplaints`: Recurring pain points.
  - `frequentlyAppreciated`: Highlights.
  - `sentiment`: Classified enum value.
- **Caching Mechanism**:
  1. If `reviews.length === 0`, returns instant zero-state without invoking Gemini.
  2. If `reviews.length === cached.reviewsAnalyzedCount` and cache age is < 24 hours, returns cached MongoDB document (0ms external latency).
  3. In-flight requests for the same listing ID share a single Promise via an in-memory `Map` lock.

### 4.3 Feature 3: Natural Language Search Engine
- **Intent Extraction**:
  Translates queries like *"Budget beachfront cottage in Goa under 3000"* into structured intent:
  ```json
  {
    "location": "Goa",
    "minPrice": null,
    "maxPrice": 3000,
    "propertyType": "Cottage",
    "keywords": ["budget", "beachfront"],
    "intentSummary": "Looking for budget beachfront cottage in Goa under ₹3,000"
  }
  ```
- **Safe Mongoose Query Compiler**:
  The backend compiler strictly evaluates only whitelisted fields:
  ```javascript
  if (interpretation.location) {
      conditions.push({
          $or: [
              { location: new RegExp(escapeRegex(interpretation.location), "i") },
              { country: new RegExp(escapeRegex(interpretation.location), "i") }
          ]
      });
  }
  ```
- **Match Rationale**:
  Each matched listing is tagged with user-facing explanation badges (e.g., *"Matched location: Goa"*, *"Price ₹2800 within budget (under ₹3000)"*).

---

## Chapter 5: Security, Robustness & Optimization

1. **Zero Secret Leakage**:
   `GEMINI_API_KEY` is loaded strictly via environment variables. `services/aiService.js` provides `sanitizeSensitiveInfo` which redacts API keys and URL params from all logs and error objects.
2. **Rate Limiting**:
   Configured `express-rate-limit` restricting AI endpoints to 25 requests per 15 minutes per IP to guard against denial-of-wallet and DDoS attacks.
3. **Transient Error Resilience**:
   `callGeminiWithRetry` wraps API calls with a 45-second timeout and 2 automatic retries with exponential backoff on HTTP 503 / 504.
4. **Model Graceful Fallback**:
   If an obsolete model name is configured in the environment, the service layer automatically falls back to `gemini-3.5-flash`.
5. **NoSQL Injection Immunity**:
   LLM output is never parsed as executable code or passed into `$where` / `$expr` operators. All query criteria use sanitized regular expressions and strict type casting.

---

## Chapter 6: Testing, Results & Verification

### 6.1 Test Suite Breakdown
Testing was automated using the native Node.js test runner (`node --test test/*.test.js`):
- **Suite 1: AI & Core Features (`test/ai_and_core_features.test.js`)**: 10 tests verifying Gemini client initialization, output validation, invalid payload rejection, error sanitization, and listing/review regression.
- **Suite 2: Comprehensive Master Test Suite (`test/complete_nikunj_ai.test.js`)**: 14 tests validating prompt injection defense, zero-review states, cache freshness, regex escaping, query builder security, and authorization guards.
- **Suite 3: HTTP Integration Suite (`test/http_integration.test.js`)**: 6 tests verifying Express router endpoints, 401 unauthenticated redirects, rate limiting, and 400 validation responses.

**Test Summary:**
```
Total Suites: 3
Total Tests: 30
Passed: 30 (100%)
Failed: 0
Duration: 1.63 seconds
```

---

## Chapter 7: Conclusion & Future Scope

### 7.1 Conclusion
Nikunj AI successfully integrates cutting-edge Generative AI capabilities into a production-style full-stack web application. By enforcing rigid grounding, constrained JSON decoding, MongoDB caching, and defensive query compilation, the system achieves the creative benefits of LLMs while eliminating hallucinations, security vulnerabilities, and excessive API costs.

### 7.2 Future Enhancements
1. **Multimodal Listing Creation**: Allow hosts to upload photographs, using Gemini Vision to automatically extract room features, views, and amenities directly from images.
2. **Vector Embeddings & Semantic Search**: Complement lexical search with MongoDB Atlas Vector Search using embeddings (`text-embedding-004`) for hybrid keyword-vector retrieval.
3. **Automated Host Review Responses**: Provide hosts with one-click AI response generation tailored to guest feedback and sentiment.

---

## References
1. Vaswani, A., et al. "Attention Is All You Need." *Advances in Neural Information Processing Systems (NeurIPS)*, 2017.
2. Google Cloud. "Gemini API Documentation & Structured Outputs with JSON Schema." *Google AI Studio Documentation*, 2024.
3. Node.js Foundation. "Asynchronous Context & Error Handling Best Practices." *Node.js Documentation*, 2024.
4. OWASP Foundation. "OWASP Top 10 for Large Language Model Applications." *OWASP GenAI Security Project*, 2023.
