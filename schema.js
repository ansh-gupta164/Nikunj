const joi = require("joi")

module.exports.listingSchema = joi.object({
    listing: joi.object({
        title: joi.string().required(),
        description : joi.string().required(),
        location: joi.string().required(),
        country: joi.string().required(),
        price : joi.number().required().min(0),
        image : joi.string().allow("",null), 
    }).required()
})

module.exports.reviewSchema= joi.object({
    review: joi.object({
        rating: joi.number().required().min(1).max(5),
        comment: joi.string().required()
    }).required(),
})

module.exports.aiListingGeneratorSchema = joi.object({
    title: joi.string().trim().max(150).allow("", null),
    location: joi.string().trim().min(2).max(150).required().messages({
        "string.empty": "Location is required to generate a listing.",
        "any.required": "Location is required to generate a listing.",
        "string.min": "Location must be at least 2 characters."
    }),
    price: joi.number().min(0).max(100000000).allow(null, ""),
    propertyType: joi.string().trim().max(60).allow("", null),
    bedrooms: joi.number().integer().min(0).max(100).allow(null, ""),
    bathrooms: joi.number().min(0).max(100).allow(null, ""),
    amenities: joi.alternatives().try(
        joi.array().items(joi.string().trim().max(100)).max(30),
        joi.string().trim().max(1000)
    ).allow("", null),
    additionalInfo: joi.string().trim().max(1200).allow("", null),
    listingId: joi.string().trim().regex(/^[0-9a-fA-F]{24}$/).allow("", null)
}).required();


