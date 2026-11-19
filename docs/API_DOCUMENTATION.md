# API Documentation: Nikunj AI

> **Nikunj AI Web & Generative AI Endpoints Reference**  
> Base URL: `http://localhost:8080` (or production host)  
> Session Auth: Cookie-based via Passport.js & Express-Session

---

## 1. Authentication & Security Middleware

All API endpoints are guarded by defensive middleware:
- **`isLoggedIn`**: Ensures the request is authenticated via an active Passport.js session. Returns a 401 redirect to `/login` for unauthenticated requests.
- **`isOwner`**: Validates that `req.user._id` matches `listing.owner`.
- **`isReviewAuthor`**: Validates that `req.user._id` matches `review.author`.
- **`aiRateLimiter`**: Express-rate-limit guard enforcing a maximum of 25 AI generation/analysis requests per 15 minutes per IP address.
- **`validateAiListing`**: Joi validation schema ensuring required listing parameters (title, location, propertyType, price) meet length and type constraints before reaching the AI service layer.

---

## 2. Generative AI Endpoints (`/ai`)

### 2.1 AI Tools Overview Hub
- **Endpoint:** `GET /ai/tools`
- **Access:** Public
- **Description:** Renders the central navigation dashboard showcasing all three AI tools with status cards and direct links.
- **Response:** HTML (`views/ai/tools-hub.ejs`)

---

### 2.2 Feature 1: AI Listing Description Generator

#### Render Generator Form
- **Endpoint:** `GET /ai/listing-generator`
- **Access:** Authenticated (`isLoggedIn`)
- **Description:** Renders the interactive AI listing generator interface with property input fields, amenity badges, and result display cards.
- **Response:** HTML (`views/ai/listing-generator.ejs`)

#### Generate Listing Content
- **Endpoint:** `POST /ai/generate-listing`
- **Access:** Authenticated (`isLoggedIn`), Rate Limited (`aiRateLimiter`)
- **Headers:** `Content-Type: application/json` or `application/x-www-form-urlencoded`
- **Request Body:**
  ```json
  {
    "listing": {
      "title": "Heritage Haveli",
      "propertyType": "Haveli",
      "location": "Jaipur, Rajasthan",
      "price": 4500,
      "bedrooms": 3,
      "bathrooms": 2,
      "amenities": ["Wi-Fi", "Courtyard", "Free Parking"],
      "additionalInfo": "Close to Hawa Mahal, authentic Rajasthani decor"
    }
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "title": "Authentic Heritage Haveli with Courtyard in Historic Jaipur",
      "description": "Step into history at this splendid heritage haveli located in the heart of Jaipur...",
      "summary": "Charming 3-bedroom Rajasthani haveli offering traditional architecture, private courtyard, and serene comfort near Hawa Mahal.",
      "highlights": [
        "Traditional Rajasthani architecture with private courtyard",
        "3 spacious bedrooms and 2 modern bathrooms",
        "High-speed Wi-Fi and complimentary secure parking",
        "Prime location within minutes of historic Hawa Mahal"
      ]
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Validation failure on input parameters.
  - `429 Too Many Requests`: Exceeded AI generation rate limit.
  - `502 Bad Gateway`: Gemini returned malformed or non-compliant JSON.
  - `503 Service Unavailable`: `GEMINI_API_KEY` missing or unconfigured.
  - `504 Gateway Timeout`: Gemini inference exceeded deadline.

---

### 2.3 Feature 2: AI Review Intelligence & Sentiment Analysis

#### View All Listings Review Insights
- **Endpoint:** `GET /ai/review-insights`
- **Access:** Public
- **Description:** Renders aggregate review intelligence cards across all properties on the platform.
- **Response:** HTML (`views/ai/all-review-insights.ejs`)

#### View Specific Listing Insights
- **Endpoint:** `GET /ai/review-insights/:id`
- **Access:** Public
- **Parameters:** `id` (MongoDB ObjectId of the listing)
- **Description:** Displays sentiment breakdown, positives, complaints, and cached summary for the specified listing.
- **Response:** HTML (`views/ai/review-insights.ejs`)

#### Execute / Force Refresh Review Analysis
- **Endpoint:** `POST /ai/review-insights/:id/analyze`
- **Access:** Public (Host can pass `forceRefresh=true` via POST body)
- **Headers:** `Content-Type: application/json`
- **Request Body (Optional):**
  ```json
  {
    "forceRefresh": true
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "overallSummary": "Guests consistently praise the pristine cleanliness, attentive hosting, and peaceful garden courtyard...",
      "positivePoints": [
        "Immaculate cleanliness throughout the property",
        "Fast and reliable Wi-Fi for remote work",
        "Attentive and responsive host communication"
      ],
      "negativePoints": [
        "Narrow lane access during peak traffic hours"
      ],
      "commonComplaints": [
        "Water pressure in second bathroom can be low in the morning"
      ],
      "frequentlyAppreciated": [
        "Peaceful courtyard atmosphere",
        "Fresh homemade breakfast"
      ],
      "sentiment": "Mostly Positive",
      "reviewsAnalyzedCount": 6,
      "lastAnalyzedAt": "2026-11-16T16:00:00.000Z",
      "isCached": true,
      "status": "cached"
    }
  }
  ```

---

### 2.4 Feature 3: AI Natural Language Search

#### Search Page Interface
- **Endpoint:** `GET /ai/search`
- **Access:** Public
- **Query Params (Optional):** `?q=villa+in+goa+under+5000`
- **Description:** Renders the natural language search UI with quick-filter chips and live results.
- **Response:** HTML (`views/ai/ai-search.ejs`)

#### Natural Language Query Parser & Execution
- **Endpoint:** `POST /ai/search`
- **Access:** Public, Rate Limited (`aiRateLimiter`)
- **Headers:** `Content-Type: application/json` or form-encoded
- **Request Body:**
  ```json
  {
    "query": "Cozy heritage stay in Jaipur under 4000 rupees with parking"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "query": "Cozy heritage stay in Jaipur under 4000 rupees with parking",
    "interpretation": {
      "location": "Jaipur",
      "minPrice": null,
      "maxPrice": 4000,
      "propertyType": "Haveli",
      "keywords": ["cozy", "heritage", "parking"],
      "intentSummary": "Looking for an affordable heritage stay in Jaipur under ₹4,000 with parking facilities.",
      "unsupportedFilters": []
    },
    "resultsCount": 3,
    "listings": [
      {
        "_id": "67401a...",
        "title": "Shanti Niwas Haveli",
        "location": "Jaipur",
        "country": "India",
        "price": 3800,
        "image": { "url": "https://..." },
        "matchReasons": [
          "Matched location: Jaipur",
          "Price ₹3800 is within budget (under ₹4000)",
          "Matches keyword: heritage"
        ]
      }
    ]
  }
  ```

---

### 2.5 AI Diagnostic & Health Check
- **Endpoint:** `GET /ai/status`
- **Access:** Public
- **Description:** Confirms whether Gemini API is configured and operational on the server without leaking keys.
- **Response (200 OK):**
  ```json
  {
    "status": "ok",
    "aiConfigured": true,
    "model": "gemini-3.5-flash",
    "timestamp": "2026-11-16T16:45:00.000Z"
  }
  ```

---

## 3. Core Listings Endpoints (`/listings`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/listings` | Public | List all listings with category filters and search |
| `GET` | `/listings/new` | `isLoggedIn` | Render new listing creation form |
| `POST` | `/listings` | `isLoggedIn` | Create new listing with Multer image upload |
| `GET` | `/listings/:id` | Public | Show single listing details and reviews |
| `GET` | `/listings/:id/edit` | `isLoggedIn`, `isOwner` | Render edit listing form |
| `PUT` | `/listings/:id` | `isLoggedIn`, `isOwner` | Update listing details and replace image |
| `DELETE` | `/listings/:id` | `isLoggedIn`, `isOwner` | Delete listing and cascade delete its reviews |

---

## 4. Reviews Endpoints (`/listings/:id/reviews`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/listings/:id/reviews` | `isLoggedIn` | Create review with rating (1-5) and comment |
| `DELETE` | `/listings/:id/reviews/:reviewId` | `isLoggedIn`, `isReviewAuthor` | Delete a review and remove reference from listing |

---

## 5. User Authentication Endpoints (`/`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/signup` | Render user signup form |
| `POST` | `/signup` | Register new user via Passport-Local-Mongoose |
| `GET` | `/login` | Render user login form |
| `POST` | `/login` | Authenticate credentials and initiate session |
| `GET` | `/logout` | Terminate session and redirect to `/listings` |
