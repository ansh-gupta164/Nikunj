# 🏠 Nikunj AI — Generative AI-Powered Listing & Review Platform

[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express-4.21-lightgrey.svg)](https://expressjs.com/)
[![MongoDB Atlas](https://img.shields.io/badge/MongoDB-Atlas%20Cloud-green.svg)](https://www.mongodb.com/atlas)
[![Google Gemini](https://img.shields.io/badge/Google%20GenAI-Gemini%203.5%20Flash-blue.svg)](https://ai.google.dev/)
[![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3-purple.svg)](https://getbootstrap.com/)
[![Tests](https://img.shields.io/badge/Tests-30%2F30%20Passing-brightgreen.svg)]()

> **Final-Year / 7th Semester Generative AI Mini-Project Submission**  
> Nikunj AI upgrades a production-grade vacation rental platform (inspired by Airbnb) into an enterprise-ready Generative AI platform utilizing Google Gemini, strict output schemas, grounding, MongoDB Atlas caching, and safe natural language query compilation.

---

## 🌟 Key Highlights & AI Features

### 1. ✍️ AI Listing Description Generator (`/ai/listing-generator`)
- **Host Copywriting Assistant**: Allows listing owners to enter property details (title, type, location, price, rooms, amenities, notes) and generates:
  - An attractive, market-ready listing title.
  - An evocative, professional property description.
  - A concise 1-2 sentence executive summary.
  - A list of 3-6 bulleted key highlights.
- **Anti-Hallucination Grounding**: Enforces strict system instructions prohibiting the generation of amenities, locations, or features not provided by the user.
- **Constrained JSON Output**: Uses Google GenAI's native JSON Schema decoding followed by server-side Joi schema validation.
- **Seamless Transfer**: Includes a one-click *"Use in New Listing"* button that pre-fills the standard listing creation form.

### 2. 📊 AI Review Analyzer & MongoDB Caching (`/ai/review-insights`)
- **Review Sentiment Intelligence**: Ingests guest reviews and generates structured insights:
  - Overall synthesized customer sentiment summary.
  - Key positive highlights praised by multiple guests.
  - Constructive shortcomings or negative points.
  - Recurring guest complaints.
  - Frequently appreciated amenities.
  - Sentiment classification badge (*Positive*, *Mostly Positive*, *Mixed*, *Neutral*, *Negative*).
- **Persistent Atlas Caching**: Results are stored directly inside the `aiReviewSummary` subdocument of the `Listing` model in MongoDB Atlas.
- **Intelligent Invalidation**:
  - Automatically re-analyzes if new reviews are posted.
  - 24-hour Time-to-Live (TTL) cache expiration.
  - Host-triggered "Force Refresh" button for on-demand analysis.
  - In-flight request de-duplication prevents duplicate concurrent Gemini API calls.
- **Zero-Review Safe State**: Beautiful fallback UI for new properties with no reviews yet.

### 3. 🔍 AI Natural Language Search (`/ai/search`)
- **Conversational Queries**: Users can search naturally (e.g., *"Cozy heritage villa in Jaipur under 4000 rupees with parking"*).
- **Safe Intent Extraction (NL2NoSQL)**: Google Gemini extracts structured search criteria (`location`, `minPrice`, `maxPrice`, `propertyType`, `keywords`, `intentSummary`).
- **NoSQL Injection Immunity**: Gemini never writes database code. A deterministic backend Mongoose query compiler (`buildSafeMongoQuery`) maps extracted parameters to sanitized, regex-escaped queries on whitelisted fields.
- **AI Match Rationale**: Results display contextual AI match badges explaining *why* each listing matched the user's intent.

### 4. 🏡 Core Listing & Review Platform (Preserved Architecture)
- **Full MVC Architecture**: Clean separation between Models, Views, and Controllers.
- **Session Authentication**: Passport.js local strategy with encrypted passwords and persistent sessions via `connect-mongo`.
- **Cloud Media Uploads**: Multer + Cloudinary storage for high-resolution property photography.
- **Owner & Author Authorization**: Robust middleware ensuring only listing owners can edit/delete properties and only review authors can delete reviews.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Browser                        │
│         EJS Templates + Bootstrap 5 + AJAX (Fetch)          │
└──────────────────────────────▲──────────────────────────────┘
                               │ HTTP / JSON
┌──────────────────────────────▼──────────────────────────────┐
│                  Express.js Application                     │
│  - Passport Session Auth     - Joi Input Validation         │
│  - Express-Rate-Limit        - Safe Error Redaction         │
├──────────────────────────────┬──────────────────────────────┤
│      Standard Controllers    │         AI Controller        │
│  (listings, reviews, users)  │       (aiController.js)      │
└──────────────┬───────────────┴──────────────┬───────────────┘
               │                              │
┌──────────────▼───────────────┐ ┌────────────▼───────────────┐
│     Mongoose ORM Layer       │ │      AI Service Layer      │
│  - Listing (with AI cache)   │ │  - aiService.js (client)   │
│  - Review                    │ │  - listingAIService.js     │
│  - User                      │ │  - reviewAIService.js      │
│                              │ │  - searchAIService.js      │
└──────────────┬───────────────┘ └────────────┬───────────────┘
               │                              │
┌──────────────▼───────────────┐ ┌────────────▼───────────────┐
│     MongoDB Atlas (Cloud)    │ │     Google GenAI Cloud     │
│       Database Cluster       │ │    (Gemini 3.5 Flash)      │
└──────────────────────────────┘ └────────────────────────────┘
```

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js (v20+) |
| **Framework** | Express.js (v4.21) |
| **GenAI SDK** | `@google/genai` (Official Google GenAI SDK) |
| **GenAI Model** | `gemini-3.5-flash` |
| **Database** | MongoDB Atlas (Cloud Cluster) |
| **ODM** | Mongoose (v8.8) |
| **Template Engine** | EJS (Embedded JavaScript) + EJS-Mate |
| **Styling** | Bootstrap 5.3 + FontAwesome Icons + Custom CSS |
| **Authentication** | Passport.js + Passport-Local + Express-Session |
| **Cloud Storage** | Cloudinary + Multer-Storage-Cloudinary |
| **Validation** | Joi |
| **Security & Limits**| Express-Rate-Limit, Regex Escaping, Key Redaction |

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18.0.0 or higher)
- npm (v9.0.0 or higher)
- MongoDB Atlas cluster URL or local MongoDB instance
- Google Gemini API key ([Get one free at Google AI Studio](https://aistudio.google.com/))
- Cloudinary credentials (for image uploads)

### 1. Clone & Install Dependencies
```bash
git clone <repository-url>
cd Nikunj
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the project root directory based on `.env.example`:
```ini
PORT=8080
NODE_ENV=development
SECRET=your_session_secret_key_here

# Database Configuration
ATLASDB_URL=mongodb+srv://<username>:<password>@cluster.mongodb.net/nikunj?retryWrites=true&w=majority

# Cloudinary Media Storage
CLOUD_NAME=your_cloudinary_cloud_name
CLOUD_API_KEY=your_cloudinary_api_key
CLOUD_API_SECRET=your_cloudinary_api_secret

# Google Gemini AI Configuration
GEMINI_API_KEY=AIzaSy...your_gemini_api_key...
GEMINI_MODEL=gemini-3.5-flash
```

> **Security Note:** Never commit your `.env` file. It is already added to `.gitignore`.

### 3. Run Automated Tests
Execute the comprehensive 30-test suite verifying unit, integration, and security layers:
```bash
npm test
```

### 4. Start the Application
```bash
node app.js
```
The server will start on `http://localhost:8080`.
At startup, safe diagnostics will log:
```
Gemini API configuration: Available (model: gemini-3.5-flash)
Connected to Atlas DB successfully.
Server is listening on port 8080
```

---

## 🧪 Comprehensive Test Suite

Run all test suites using:
```bash
npm test
```
The test harness runs 3 test suites with 30 passing assertions:
1. `test/ai_and_core_features.test.js`: Core Gemini client initialization, output validation, error sanitization, and listing/review regression tests.
2. `test/complete_nikunj_ai.test.js`: Prompt injection defense, zero-review handling, cache freshness logic, regex escaping, and Mongoose query compilation.
3. `test/http_integration.test.js`: Route authorization guards, 401 unauthenticated redirects, rate limiting, and 400 validation responses.

---

## 📚 Academic & Viva Documentation

The `docs/` directory contains complete documentation for academic evaluations:
- **[PROJECT_REPORT.md](docs/PROJECT_REPORT.md)**: Full academic mini-project report (Abstract, Introduction, Architecture, GenAI Implementation, Security, Results, and References).
- **[GENERATIVE_AI_CONCEPTS.md](docs/GENERATIVE_AI_CONCEPTS.md)**: Theoretical guide covering LLMs, Structured Outputs, Grounding, Prompt Injection, and Cost/Latency Caching.
- **[VIVA_QUESTIONS.md](docs/VIVA_QUESTIONS.md)**: 25+ detailed Examiner Viva Voce Questions with comprehensive model answers.
- **[API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md)**: Complete endpoint reference for all core and AI routes.

---

## 🔒 Security Best Practices Implemented

1. **Zero Secret Leakage**: `GEMINI_API_KEY` is loaded on the server and redacted from all logs and error responses.
2. **Defensive Prompt Sanitization**: Incoming reviews are sanitized to neutralize prompt injection attempts.
3. **NoSQL Injection Guard**: Safe Mongoose query compiler prevents arbitrary `$where` or regex injection.
4. **Rate Limiting**: AI endpoints are capped at 25 requests per 15 minutes per IP.
5. **Session Security**: MongoDB-backed sessions with `httpOnly` cookies and expiration policies.
