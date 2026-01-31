import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";

const ai = new GoogleGenAI({
  apiKey: env.geminiApiKey,
});

/**
 * Extract menu items from image using Google Gemini
 */
export async function extractMenuFromImage(imageBuffer, mimeType = "image/jpeg") {
  const base64Image = imageBuffer.toString("base64");

  const prompt = `You are a professional menu extraction specialist. Analyze this restaurant menu card image and extract ALL visible menu items with maximum accuracy.

CRITICAL REQUIREMENTS:
1. ALWAYS provide a description for every item - if not visible, generate a brief generic description based on the item name
2. ALWAYS determine dietary type (Veg/Non-Veg) - use visual indicators (green/red dots), item name, or make an educated guess
3. Extract prices exactly as shown
4. Organize items into logical categories

FIELD REQUIREMENTS:
- name: REQUIRED - exact item name from menu
- price: REQUIRED - numeric value only (e.g., 299.00 not "₹299")
- description: REQUIRED - either from menu OR generated generic description (e.g., "Delicious {item name}" or "Popular {category} item")
- dietaryType: REQUIRED - must be either "Veg" or "Non-Veg" (look for green/red dots, analyze item name, or make best guess)
- confidence: 0.0 to 1.0 based on extraction certainty

DIETARY TYPE DETECTION RULES:
- Green dot/symbol = Veg
- Red dot/symbol = Non-Veg
- Items with "Chicken", "Mutton", "Fish", "Egg", "Prawn" = Non-Veg
- Items with "Paneer", "Veg", vegetable names = Veg
- If unclear, analyze ingredients or make educated guess
- Never leave dietaryType empty

DESCRIPTION GENERATION (if not visible on menu):
- For appetizers: "Crispy and delicious {item name}"
- For main course: "Popular {item name} prepared with authentic spices"
- For beverages: "Refreshing {item name}"
- For desserts: "Sweet and delicious {item name}"
- Keep descriptions simple and appealing

Return ONLY valid JSON (no markdown, no preamble) in this exact structure:
{
  "currency": "₹",
  "categories": [
    {
      "name": "Category Name",
      "confidence": 0.95,
      "items": [
        {
          "name": "Item Name",
          "price": 299.00,
          "description": "Brief description or generated description",
          "dietaryType": "Veg",
          "confidence": 0.92,
          "notes": null
        }
      ]
    }
  ],
  "overallConfidence": 0.90,
  "extractionNotes": "Overall observations"
}

IMPORTANT: Every item MUST have name, price, description, and dietaryType. Never use null for these fields.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Image,
            },
          },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2, // Slightly higher for creative descriptions
      maxOutputTokens: 4096,
    },
  });

  const text = response.text;

  return parseExtractionResponse(text);
}

/**
 * Parse AI response into structured format with validation and fallbacks
 */
function parseExtractionResponse(text) {
  try {
    let cleaned = text.trim();

    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(cleaned);

    if (!parsed.categories || !Array.isArray(parsed.categories)) {
      throw new Error("Invalid response: missing categories array");
    }

    // Validate and ensure all required fields are present
    parsed.categories = parsed.categories.map((cat) => ({
      name: cat.name || "Unnamed Category",
      confidence: cat.confidence || 0.5,
      items: (cat.items || []).map((item) => {
        // Ensure required fields with fallbacks
        const validatedItem = {
          name: item.name || "Unnamed Item",
          price: parseFloat(item.price) || 0,
          description: ensureDescription(item),
          dietaryType: ensureDietaryType(item),
          confidence: item.confidence || 0.5,
          notes: item.notes || null,
        };

        return validatedItem;
      }),
    }));

    return {
      currency: parsed.currency || "₹",
      categories: parsed.categories,
      overallConfidence: parsed.overallConfidence || 0.5,
      extractionNotes: parsed.extractionNotes,
    };
  } catch (error) {
    console.error("[Gemini] Failed to parse response:", error);
    console.error("[Gemini] Raw text:", text.substring(0, 500));
    throw new Error(`Failed to parse AI response: ${error.message}`);
  }
}

/**
 * Ensure item has a description - generate one if missing
 */
function ensureDescription(item) {
  // If description exists and is not empty, use it
  if (item.description && item.description.trim()) {
    return item.description.trim();
  }

  // Generate generic description based on item name
  const name = item.name || "item";
  
  // Simple generic descriptions
  const templates = [
    `Delicious ${name}`,
    `Popular ${name}`,
    `Tasty ${name}`,
    `Fresh ${name}`,
  ];

  // Pick a random template
  const template = templates[Math.floor(Math.random() * templates.length)];
  
  return template;
}

/**
 * Ensure item has a dietary type - make educated guess if missing
 */
function ensureDietaryType(item) {
  // If dietaryType exists and is valid, use it
  if (item.dietaryType === "Veg" || item.dietaryType === "Non-Veg") {
    return item.dietaryType;
  }

  // Analyze item name for clues
  const name = (item.name || "").toLowerCase();
  const description = (item.description || "").toLowerCase();
  const combined = `${name} ${description}`;

  // Non-veg indicators
  const nonVegKeywords = [
    "chicken", "mutton", "lamb", "beef", "pork", "fish", "prawn", "shrimp",
    "crab", "lobster", "egg", "meat", "tandoori chicken", "butter chicken",
    "biryani", "kebab", "seekh"
  ];

  // Veg indicators
  const vegKeywords = [
    "paneer", "veg", "vegetable", "aloo", "gobi", "palak", "dal", "chana",
    "mushroom", "corn", "cheese", "capsicum", "tomato", "onion"
  ];

  // Check for non-veg keywords
  for (const keyword of nonVegKeywords) {
    if (combined.includes(keyword)) {
      return "Non-Veg";
    }
  }

  // Check for veg keywords
  for (const keyword of vegKeywords) {
    if (combined.includes(keyword)) {
      return "Veg";
    }
  }

  // Default to Veg if uncertain (safer assumption for Indian restaurants)
  return "Veg";
}

/**
 * Calculate overall confidence score (0-100)
 */
export function calculateConfidence(result) {
  const { categories } = result;

  if (!categories || categories.length === 0) return 0;

  const allItems = categories.flatMap((cat) => cat.items);
  if (allItems.length === 0) return 0;

  const itemConfidence =
    allItems.reduce((sum, item) => sum + item.confidence, 0) /
    allItems.length;

  const categoryConfidence =
    categories.reduce((sum, cat) => sum + cat.confidence, 0) /
    categories.length;

  return Math.round((itemConfidence * 0.7 + categoryConfidence * 0.3) * 100);
}