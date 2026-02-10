import { createPresignedUploadUrl, publicFileUrl } from "../media/s3.js";
import { createPgPool } from "../db.js";
import { env } from "../config/env.js";

const pool = createPgPool(env.databaseUrl);

// Helper to get full S3 URL for logo templates
function getLogoUrl(s3Path) {
  // Remove leading slash if present
  const cleanPath = s3Path.startsWith('/') ? s3Path.substring(1) : s3Path;
  return publicFileUrl(cleanPath);
}

// Predefined logo templates - all available for any business type
export const PREDEFINED_LOGOS = [
  // Cafe & Coffee Logos
  {
    id: "modern-cafe",
    name: "Modern Cafe",
    thumbnail: getLogoUrl("logos/templates/modern-cafe-thumb.png"),
    url: getLogoUrl("logos/templates/modern-cafe.png"),
    description: "Minimalist coffee cup design"
  },
  {
    id: "vintage-coffee",
    name: "Vintage Coffee",
    thumbnail: getLogoUrl("logos/templates/vintage-coffee-thumb.png"),
    url: getLogoUrl("logos/templates/vintage-coffee.png"),
    description: "Classic coffee bean illustration"
  },
  {
    id: "espresso-bar",
    name: "Espresso Bar",
    thumbnail: getLogoUrl("logos/templates/espresso-bar-thumb.png"),
    url: getLogoUrl("logos/templates/espresso-bar.png"),
    description: "Urban coffee bar style"
  },

  // Restaurant Logos
  {
    id: "classic-restaurant",
    name: "Classic Restaurant",
    thumbnail: getLogoUrl("logos/templates/classic-restaurant-thumb.png"),
    url: getLogoUrl("logos/templates/classic-restaurant.png"),
    description: "Elegant dining emblem"
  },
  {
    id: "fine-dining",
    name: "Fine Dining",
    thumbnail: getLogoUrl("logos/templates/fine-dining-thumb.png"),
    url: getLogoUrl("logos/templates/fine-dining.png"),
    description: "Premium restaurant crest"
  },
  {
    id: "bistro",
    name: "Bistro Style",
    thumbnail: getLogoUrl("logos/templates/bistro-thumb.png"),
    url: getLogoUrl("logos/templates/bistro.png"),
    description: "Casual European dining"
  },

  // Fast Food / QSR Logos
  {
    id: "fast-food",
    name: "Fast Food",
    thumbnail: getLogoUrl("logos/templates/fast-food-thumb.png"),
    url: getLogoUrl("logos/templates/fast-food.png"),
    description: "Quick service bold design"
  },
  {
    id: "burger-joint",
    name: "Burger Joint",
    thumbnail: getLogoUrl("logos/templates/burger-joint-thumb.png"),
    url: getLogoUrl("logos/templates/burger-joint.png"),
    description: "American burger icon"
  },
  {
    id: "food-truck",
    name: "Food Truck",
    thumbnail: getLogoUrl("logos/templates/food-truck-thumb.png"),
    url: getLogoUrl("logos/templates/food-truck.png"),
    description: "Street food mobile style"
  },

  // Pizza Logos
  {
    id: "pizza-place",
    name: "Pizza Place",
    thumbnail: getLogoUrl("logos/templates/pizza-place-thumb.png"),
    url: getLogoUrl("logos/templates/pizza-place.png"),
    description: "Italian pizzeria design"
  },
  {
    id: "pizza-slice",
    name: "Pizza Slice",
    thumbnail: getLogoUrl("logos/templates/pizza-slice-thumb.png"),
    url: getLogoUrl("logos/templates/pizza-slice.png"),
    description: "Casual pizza shop"
  },

  // Bakery Logos
  {
    id: "bakery-fresh",
    name: "Fresh Bakery",
    thumbnail: getLogoUrl("logos/templates/bakery-fresh-thumb.png"),
    url: getLogoUrl("logos/templates/bakery-fresh.png"),
    description: "Artisan bread and pastries"
  },
  {
    id: "bakery-wheat",
    name: "Wheat Bakery",
    thumbnail: getLogoUrl("logos/templates/bakery-wheat-thumb.png"),
    url: getLogoUrl("logos/templates/bakery-wheat.png"),
    description: "Traditional bakery emblem"
  },
  {
    id: "cake-shop",
    name: "Cake Shop",
    thumbnail: getLogoUrl("logos/templates/cake-shop-thumb.png"),
    url: getLogoUrl("logos/templates/cake-shop.png"),
    description: "Custom cakes and desserts"
  },

  // Ice Cream / Dessert Logos
  {
    id: "ice-cream-shop",
    name: "Ice Cream Shop",
    thumbnail: getLogoUrl("logos/templates/ice-cream-shop-thumb.png"),
    url: getLogoUrl("logos/templates/ice-cream-shop.png"),
    description: "Sweet frozen treats"
  },
  {
    id: "ice-cream-cone",
    name: "Ice Cream Cone",
    thumbnail: getLogoUrl("logos/templates/ice-cream-cone-thumb.png"),
    url: getLogoUrl("logos/templates/ice-cream-cone.png"),
    description: "Classic ice cream parlor"
  },
  {
    id: "dessert-cafe",
    name: "Dessert Cafe",
    thumbnail: getLogoUrl("logos/templates/dessert-cafe-thumb.png"),
    url: getLogoUrl("logos/templates/dessert-cafe.png"),
    description: "Sweet treats and beverages"
  },

  // Bar / Brewery Logos
  {
    id: "craft-brewery",
    name: "Craft Brewery",
    thumbnail: getLogoUrl("logos/templates/craft-brewery-thumb.png"),
    url: getLogoUrl("logos/templates/craft-brewery.png"),
    description: "Artisan beer house"
  },
  {
    id: "sports-bar",
    name: "Sports Bar",
    thumbnail: getLogoUrl("logos/templates/sports-bar-thumb.png"),
    url: getLogoUrl("logos/templates/sports-bar.png"),
    description: "Casual bar and grill"
  },
  {
    id: "cocktail-lounge",
    name: "Cocktail Lounge",
    thumbnail: getLogoUrl("logos/templates/cocktail-lounge-thumb.png"),
    url: getLogoUrl("logos/templates/cocktail-lounge.png"),
    description: "Upscale cocktail bar"
  },

  // Generic / Multi-purpose Logos
  {
    id: "chef-hat",
    name: "Chef's Hat",
    thumbnail: getLogoUrl("logos/templates/chef-hat-thumb.png"),
    url: getLogoUrl("logos/templates/chef-hat.png"),
    description: "Professional kitchen symbol"
  },
  {
    id: "fork-knife",
    name: "Fork & Knife",
    thumbnail: getLogoUrl("logos/templates/fork-knife-thumb.png"),
    url: getLogoUrl("logos/templates/fork-knife.png"),
    description: "Classic dining utensils"
  },
  {
    id: "plate-dining",
    name: "Plate Dining",
    thumbnail: getLogoUrl("logos/templates/plate-dining-thumb.png"),
    url: getLogoUrl("logos/templates/plate-dining.png"),
    description: "Elegant plate presentation"
  },
  {
    id: "food-bowl",
    name: "Food Bowl",
    thumbnail: getLogoUrl("logos/templates/food-bowl-thumb.png"),
    url: getLogoUrl("logos/templates/food-bowl.png"),
    description: "Healthy bowl concept"
  },
  {
    id: "spoon-fork",
    name: "Spoon & Fork",
    thumbnail: getLogoUrl("logos/templates/spoon-fork-thumb.png"),
    url: getLogoUrl("logos/templates/spoon-fork.png"),
    description: "Simple dining icon"
  }
];

// Rest of your service functions remain the same...
export async function getPredefinedLogos() {
  return PREDEFINED_LOGOS;
}


/**
 * Generate presigned URL for custom logo upload
 */
export async function generateLogoUploadUrl(restaurantId, contentType) {
  // Validate content type
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
  if (!allowedTypes.includes(contentType)) {
    throw new Error('Invalid file type. Only PNG and JPEG images are allowed.');
  }

  // Generate unique key
  const timestamp = Date.now();
  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  const key = `logos/custom/${restaurantId}/${timestamp}.${extension}`;

  // Create presigned upload URL
  const uploadUrl = await createPresignedUploadUrl({
    key,
    contentType,
    expiresIn: 600, // 10 minutes
  });

  const publicUrl = publicFileUrl(key);

  return {
    uploadUrl,
    key,
    publicUrl,
    expiresIn: 600,
  };
}

/**
 * Update restaurant logo
 */
export async function updateRestaurantLogo(restaurantId, logoData) {
  const { type, url, key } = logoData;

  // Validate logo type
  if (!['predefined', 'custom'].includes(type)) {
    throw new Error('Invalid logo type');
  }

  // If predefined, validate it exists
  if (type === 'predefined') {
    const predefinedLogo = PREDEFINED_LOGOS.find(logo => logo.url === url);
    if (!predefinedLogo) {
      throw new Error('Invalid predefined logo');
    }
  }

  // Update restaurant settings
  const result = await pool.query(
    `UPDATE restaurants
     SET settings = COALESCE(settings, '{}'::jsonb) || 
                   jsonb_build_object(
                     'logo', jsonb_build_object(
                       'type', $1,
                       'url', $2,
                       'key', $3,
                       'updatedAt', $4
                     )
                   ),
         updated_at = now()
     WHERE id = $5
     RETURNING id, name, settings`,
    [type, url, key || null, new Date().toISOString(), restaurantId]
  );

  return result.rows[0];
}

/**
 * Get restaurant logo
 */
export async function getRestaurantLogo(restaurantId) {
  const result = await pool.query(
    `SELECT settings->'logo' as logo
     FROM restaurants
     WHERE id = $1`,
    [restaurantId]
  );

  const row = result.rows[0];
  if (!row || !row.logo) {
    return null;
  }

  return row.logo;
}

/**
 * Delete custom restaurant logo
 */
export async function deleteRestaurantLogo(restaurantId) {
  const result = await pool.query(
    `UPDATE restaurants
     SET settings = settings - 'logo',
         updated_at = now()
     WHERE id = $1
     RETURNING id, name`,
    [restaurantId]
  );

  return result.rows[0];
}