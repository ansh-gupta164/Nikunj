const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("path");
const ejsMate = require("ejs-mate");
const EventEmitter = require("node:events");

const aiRouter = require("../routes/ai");

// Helper to simulate in-process Express requests without TCP sockets
function simulateRequest(app, { method = "GET", url = "/", headers = {}, body = null }) {
    return new Promise((resolve) => {
        const req = new EventEmitter();
        req.method = method;
        req.url = url;
        req.originalUrl = url;
        req.headers = { host: "localhost", ...headers };
        req.body = body || {};
        req.ip = "127.0.0.1";
        req.app = app;
        req.get = (headerName) => req.headers[headerName.toLowerCase()];
        req.header = req.get;

        let statusCode = 200;
        let responseHeaders = {};
        let responseBody = "";

        const res = {
            statusCode: 200,
            locals: {},
            status(code) {
                statusCode = code;
                this.statusCode = code;
                return this;
            },
            set(name, value) {
                responseHeaders[name.toLowerCase()] = value;
                return this;
            },
            setHeader(name, value) {
                responseHeaders[name.toLowerCase()] = value;
                return this;
            },
            getHeader(name) {
                return responseHeaders[name.toLowerCase()];
            },
            redirect(url) {
                statusCode = 302;
                responseHeaders["location"] = url;
                resolve({
                    status: 302,
                    headers: responseHeaders,
                    text: () => Promise.resolve("")
                });
            },
            send(data) {
                responseBody = typeof data === "object" ? JSON.stringify(data) : String(data);
                resolve({
                    status: statusCode,
                    headers: responseHeaders,
                    text: () => Promise.resolve(responseBody),
                    json: () => Promise.resolve(typeof data === "object" ? data : JSON.parse(responseBody))
                });
            },
            json(data) {
                responseHeaders["content-type"] = "application/json";
                responseBody = JSON.stringify(data);
                resolve({
                    status: statusCode,
                    headers: responseHeaders,
                    text: () => Promise.resolve(responseBody),
                    json: () => Promise.resolve(data)
                });
            },
            render(view, options) {
                const mergedOptions = {
                    ...res.locals,
                    ...options,
                    success: [],
                    error: []
                };
                app.render(view, mergedOptions, (err, html) => {
                    if (err) {
                        statusCode = 500;
                        resolve({
                            status: 500,
                            headers: responseHeaders,
                            text: () => Promise.resolve(err.message)
                        });
                    } else {
                        resolve({
                            status: statusCode,
                            headers: responseHeaders,
                            text: () => Promise.resolve(html)
                        });
                    }
                });
            }
        };

        app.handle(req, res);
    });
}

describe("HTTP INTEGRATION & ROUTE VERIFICATION (In-Process)", () => {
    let app;
    let mockUser = {
        _id: "507f1f77bcf86cd799439011",
        username: "testuser",
        email: "test@example.com"
    };
    let isAuthenticatedState = false;

    before(() => {
        app = express();
        app.engine("ejs", ejsMate);
        app.set("view engine", "ejs");
        app.set("views", path.join(__dirname, "../views"));

        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        // Flash & user mock middleware
        app.use((req, res, next) => {
            req.isAuthenticated = () => isAuthenticatedState;
            req.user = isAuthenticatedState ? mockUser : null;
            req.session = {};
            req.flash = () => [];
            res.locals.success = [];
            res.locals.error = [];
            res.locals.currUser = req.user;
            next();
        });

        app.use("/ai", aiRouter);

        // Global error handler
        app.use((err, req, res, next) => {
            const statusCode = err.statusCode || err.status || 500;
            if (req.headers.accept && req.headers.accept.includes("application/json")) {
                return res.status(statusCode).json({ success: false, error: err.message });
            }
            res.status(statusCode).send(err.message);
        });
    });

    test("GET /ai redirects to /ai/tools when authenticated", async () => {
        isAuthenticatedState = true;
        const res = await simulateRequest(app, { method: "GET", url: "/ai" });
        assert.equal(res.status, 302);
        assert.ok(res.headers["location"].includes("/ai/tools"));
    });

    test("GET /ai/listing-generator renders HTML view with 200 OK when authenticated", async () => {
        isAuthenticatedState = true;
        const res = await simulateRequest(app, { method: "GET", url: "/ai/listing-generator" });
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes("AI Listing Generator"), "Page must contain main heading");
        assert.ok(html.includes("Generate with AI"), "Page must contain generate button");
        assert.ok(html.includes("propLocation"), "Page must contain location input");
        assert.ok(html.includes("aiResultsCard"), "Page must contain results card");
    });

    test("GET /ai/listing-generator redirects unauthenticated users to /login", async () => {
        isAuthenticatedState = false;
        const res = await simulateRequest(app, { method: "GET", url: "/ai/listing-generator" });
        assert.equal(res.status, 302);
        assert.ok(res.headers["location"].includes("/login"));
    });

    test("POST /ai/generate-listing rejects unauthenticated AJAX with 401 JSON", async () => {
        isAuthenticatedState = false;
        const res = await simulateRequest(app, {
            method: "POST",
            url: "/ai/generate-listing",
            headers: {
                "content-type": "application/json",
                "accept": "application/json"
            },
            body: { location: "Jaipur" }
        });
        assert.equal(res.status, 401);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.ok(json.error.includes("logged in"));
    });

    test("POST /ai/generate-listing rejects missing location with 400 JSON", async () => {
        isAuthenticatedState = true;
        const res = await simulateRequest(app, {
            method: "POST",
            url: "/ai/generate-listing",
            headers: {
                "content-type": "application/json",
                "accept": "application/json"
            },
            body: { title: "My Stay" }
        });
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.success, false);
        assert.ok(json.error.includes("Location is required"));
    });

    test("POST /ai/generate-listing rejects negative price with 400 JSON", async () => {
        isAuthenticatedState = true;
        const res = await simulateRequest(app, {
            method: "POST",
            url: "/ai/generate-listing",
            headers: {
                "content-type": "application/json",
                "accept": "application/json"
            },
            body: { location: "Shimla", price: -100 }
        });
        assert.equal(res.status, 400);
        const json = await res.json();
        assert.equal(json.success, false);
    });
});
