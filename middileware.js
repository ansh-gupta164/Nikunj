
const Listing = require("./models/listing");
const Review = require("./models/review");
const { listingSchema, reviewSchema, aiListingGeneratorSchema } = require("./schema.js")
const ExpressError = require("./utils/ExpressError.js")
const rateLimit = require("express-rate-limit");

module.exports.isLoggedIn = (req, res, next) => {
    if (!req.isAuthenticated()) {
        if (req.headers.accept && req.headers.accept.includes("application/json")) {
            return res.status(401).json({
                success: false,
                error: "You must be logged in to perform this action."
            });
        }
        if (req.method === "GET") {
            req.session.redirectUrl = req.originalUrl;
        }

        req.flash("error", "please log in")
        return res.redirect("/login")
    }
    next()
}

// module.exports.isLoggedIn = (req, res, next) => {
//     if (!req.isAuthenticated()) {
//         req.session.redirectUrl = req.originalUrl;   // save redirect here

//         console.log("Saving redirect URL:", req.originalUrl);   // ADD THIS
//         console.log("Session now:", req.session);               // ADD THIS

//         req.flash("error", "Please log in first.");
//         return res.redirect("/login");
//     }
//     next();
// };

module.exports.savedRedirectUrl = (req, res, next) => {
    if (req.session.redirectUrl) {
        res.locals.redirectUrl = req.session.redirectUrl
    }
    next()
}

module.exports.isOwner = async (req, res, next) => {
    let { id } = req.params;
    let listing = await Listing.findById(id)
    if (!listing.owner || !listing.owner.equals(req.user._id)) {
        req.flash("error", "you are not owner")
        return res.redirect(`/listings/${id}`)
    }
    next()
}


module.exports.validateListing = (req, res, next) => {
    let { error } = listingSchema.validate(req.body)

    if (error) {
        let errMsg = error.details.map((el) => el.message).join(",")
        throw new ExpressError(400, errMsg)
    }
    else {
        next()
    }
}

module.exports.validateReview = (req, res, next) => {
    let { error } = reviewSchema.validate(req.body)

    if (error) {
        throw new ExpressError(400, error)
    } else {
        next()
    }
}

module.exports.isReviewAuthor = async (req, res, next) => {

    let { id, reviewId } = req.params
    let review = await Review.findById(reviewId)
    if (!review.author.equals(res.locals.currUser._id)) {
        req.flash("error", "you are not author of the review")
        return res.redirect(`/listings/${id}`)
    }
    next()
}

// AI Rate Limiter: 30 requests per 15 minutes per IP
module.exports.aiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: "Too many AI generation requests from this IP. Please try again after 15 minutes."
    }
});

// AI Listing Input Validation Middleware
module.exports.validateAiListing = (req, res, next) => {
    const { error } = aiListingGeneratorSchema.validate(req.body);
    if (error) {
        const errMsg = error.details.map((el) => el.message).join(", ");
        if (req.headers.accept && req.headers.accept.includes("application/json")) {
            return res.status(400).json({ success: false, error: errMsg });
        }
        throw new ExpressError(400, errMsg);
    }
    next();
};
