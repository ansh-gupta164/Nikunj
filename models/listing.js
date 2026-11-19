const mongoose = require("mongoose");
const Schema = mongoose.Schema
const Review = require("./review.js");

const listingSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },

    description: {
        type: String,
    },

    image: {
        filename: String,
        url: String,
    },

    price: {
        type: Number,
        required: true,
    },

    location: {
        type: String,
    },

    country: {
        type: String,
    },


    reviews: [
        {
            type: Schema.Types.ObjectId,
            ref: "Review"
        }
    ],
    owner: {
        type: Schema.Types.ObjectId,
        ref: "User",
        require: true
    },

    // AI Review Intelligence Cache (Feature 2)
    aiReviewSummary: {
        overallSummary: { type: String, default: "" },
        positivePoints: [{ type: String }],
        negativePoints: [{ type: String }],
        commonComplaints: [{ type: String }],
        frequentlyAppreciated: [{ type: String }],
        sentiment: {
            type: String,
            enum: ["Positive", "Mostly Positive", "Mixed", "Neutral", "Mostly Negative", "Negative", "Insufficient Data"],
            default: "Insufficient Data"
        },
        reviewsAnalyzedCount: { type: Number, default: 0 },
        lastAnalyzedAt: { type: Date }
    }
});

listingSchema.post("findOneAndDelete", async (listing) => {
    if (listing) {
        await Review.deleteMany({ _id: { $in: listing.reviews } })
    }
})

const Listing = mongoose.model("Listing", listingSchema);

module.exports = Listing;