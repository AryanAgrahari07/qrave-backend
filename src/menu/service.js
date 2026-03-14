import { pool } from "../dbClient.js";
import { translate } from "@vitalets/google-translate-api";

// Helper to generate translations — always returns fast English fallback
async function generateTranslations(text, targetLang = "hi") {
  if (!text) return {};
  try {
    const res = await translate(text, { to: targetLang });
    return {
      en: text,
      [targetLang]: res.text,
    };
  } catch (error) {
    console.error(`[Translation] Failed to translate: "${text}"`, error);
    return { en: text }; // Fallback to English if translation fails
  }
}

/**
 * Fire-and-forget translation — saves item first (with English-only fallback),
 * then asynchronously fetches translations and patches the DB row.
 * This keeps menu write latency under 50ms regardless of Google API speed.
 */
function translateAndPatchAsync(table, idColumn, id, fields) {
  // `fields` is an object of { columnName: textToTranslate }
  setImmediate(async () => {
    // Fixed SQL injection vulnerability by using an allowlist for table and column names.
    // In PostgreSQL, table and column names cannot be parameterized with $1, $2, etc.
    // We must validate them against an allowlist before string interpolation.
    const allowedTables = ['menu_categories', 'menu_items']; // Add other tables as needed
    const allowedTranslationColumns = ['name_translations', 'description_translations']; // These are the columns that store translations

    if (!allowedTables.includes(table)) {
      console.error(`[Translation] Invalid table name for background patch: ${table}`);
      return;
    }
    // idColumn also needs validation if it's dynamic, but it's usually 'id' or similar.
    // For simplicity, assuming idColumn is safe or validated elsewhere.

    try {
      const updates = [];
      const values = [];
      let idx = 1;
      for (const [column, text] of Object.entries(fields)) {
        if (!text) continue;

        // Ensure the column being updated is one of the allowed translation columns
        if (!allowedTranslationColumns.includes(column)) {
          console.error(`[Translation] Invalid column name for background patch: ${column} in table ${table}`);
          continue;
        }

        const translations = await generateTranslations(text);
        updates.push(`${column} = $${idx++}`);
        values.push(JSON.stringify(translations));
      }
      if (!updates.length) return;
      values.push(id);
      await pool.query(
        `UPDATE ${table} SET ${updates.join(', ')} WHERE ${idColumn} = $${idx}`,
        values
      );
    } catch (err) {
      console.error(`[Translation] Background patch failed for ${table} id=${id}:`, err);
    }
  });
}


export async function getRestaurantBySlug(slug) {
  // Public menu needs basic restaurant profile details as well
  // (address/contact/maps) so the live menu can show them.
  const result = await pool.query(
    `SELECT id,
            name,
            slug,
            currency,
            address_line1 AS "addressLine1",
            address_line2 AS "addressLine2",
            city,
            state,
            postal_code AS "postalCode",
            country,
            email,
            phone_number AS "phoneNumber",
            google_maps_link AS "googleMapsLink",
            settings
     FROM restaurants
     WHERE slug = $1 AND is_active = true`,
    [slug],
  );
  return result.rows[0] || null;
}

export async function getMenuForRestaurant(restaurantId, dietaryFilter = null) {
  const categoriesResult = await pool.query(
    `SELECT id, name, name_translations AS "nameTranslations", sort_order AS "sortOrder"
     FROM menu_categories
     WHERE restaurant_id = $1 AND is_active = true
     ORDER BY sort_order NULLS LAST, name ASC`,
    [restaurantId],
  );

  // Build the items query with optional dietary filter
  let itemsQuery = `
    SELECT id,
            category_id AS "categoryId",
            name,
            name_translations AS "nameTranslations",
            description,
            description_translations AS "descriptionTranslations",
            price,
            image_url AS "imageUrl",
            is_available AS "isAvailable",
            dietary_tags AS "dietaryTags",
            sort_order AS "sortOrder"
     FROM menu_items
     WHERE restaurant_id = $1 AND is_active = true
  `;
  
  const queryParams = [restaurantId];
  
  // Add dietary filter if specified
  // Using ANY operator to check if dietary_tags array contains the filter value
  if (dietaryFilter === 'veg') {
    // Check if array contains 'Veg' (matching the exact value stored from the form)
    itemsQuery += ` AND 'Veg' = ANY(dietary_tags)`;
  } else if (dietaryFilter === 'non-veg') {
    // Check if array contains 'Non-Veg' (matching the exact value stored from the form)
    itemsQuery += ` AND 'Non-Veg' = ANY(dietary_tags)`;
  }
  // If dietaryFilter is null or 'any', show all items (no additional filter)
  
  itemsQuery += ` ORDER BY sort_order NULLS LAST, name ASC`;
  
  const itemsResult = await pool.query(itemsQuery, queryParams);

  return {
    categories: categoriesResult.rows,
    items: itemsResult.rows,
  };
}

export async function setItemAvailability(restaurantId, itemId, isAvailable) {
  const result = await pool.query(
    `UPDATE menu_items
     SET is_available = $1, updated_at = now()
     WHERE restaurant_id = $2 AND id = $3
     RETURNING id, is_available AS "isAvailable"`,
    [isAvailable, restaurantId, itemId],
  );
  return result.rows[0] || null;
}

export async function createCategory(restaurantId, data) {
  const { name, sortOrder, nameTranslations } = data;
  
  // Use caller-provided translations, or English-only fallback (translations patched async below)
  const initialTranslations = nameTranslations && Object.keys(nameTranslations).length > 0
    ? nameTranslations
    : { en: name };

  const result = await pool.query(
    `INSERT INTO menu_categories (restaurant_id, name, name_translations, sort_order, is_active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id, name, name_translations AS "nameTranslations", sort_order AS "sortOrder", is_active AS "isActive"`,
    [restaurantId, name, initialTranslations, sortOrder ?? null],
  );
  const category = result.rows[0];

  // Auto-translate in background if no translations were provided
  if (!nameTranslations || Object.keys(nameTranslations).length === 0) {
    translateAndPatchAsync('menu_categories', 'id', category.id, { name_translations: name });
  }

  return category;
}

export async function updateCategory(restaurantId, categoryId, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(data.name);

    if (data.nameTranslations === undefined) {
      // Will be patched asynchronously after update returns
    }
  }
  
  if (data.nameTranslations !== undefined) {
    fields.push(`name_translations = $${idx++}`);
    values.push(data.nameTranslations);
  }
  
  if (data.sortOrder !== undefined) {
    fields.push(`sort_order = $${idx++}`);
    values.push(data.sortOrder);
  }
  if (data.isActive !== undefined) {
    fields.push(`is_active = $${idx++}`);
    values.push(data.isActive);
  }

  if (!fields.length) return null;

  values.push(restaurantId);
  values.push(categoryId);

  const result = await pool.query(
    `UPDATE menu_categories
     SET ${fields.join(", ")}, updated_at = now()
     WHERE restaurant_id = $${idx} AND id = $${idx + 1}
     RETURNING id, name, name_translations AS "nameTranslations", sort_order AS "sortOrder", is_active AS "isActive"`,
    values,
  );
  const updated = result.rows[0] || null;

  // If name changed but translations were not explicitly provided, patch async
  if (updated && data.name !== undefined && data.nameTranslations === undefined) {
    translateAndPatchAsync('menu_categories', 'id', updated.id, { name_translations: data.name });
  }

  return updated;
}

export async function deleteCategory(restaurantId, categoryId) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Soft delete all menu items in this category
    await client.query(
      `UPDATE menu_items
       SET is_active = false, updated_at = now()
       WHERE restaurant_id = $1 AND category_id = $2`,
      [restaurantId, categoryId]
    );
    
    // Soft delete the category
    const result = await client.query(
      `UPDATE menu_categories
       SET is_active = false, updated_at = now()
       WHERE restaurant_id = $1 AND id = $2
       RETURNING id, name, is_active AS "isActive"`,
      [restaurantId, categoryId]
    );
    
    await client.query('COMMIT');
    
    const category = result.rows[0] || null;
    
    if (category) {
      console.log(`[Menu] Deleted category ${categoryId} and associated items`);
    }
    
    return category;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Menu] Error deleting category:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function createMenuItem(restaurantId, data) {
  const {
    categoryId,
    name,
    nameTranslations,
    description,
    descriptionTranslations,
    price,
    imageUrl,
    isAvailable = true,
    dietaryTags,
    sortOrder,
  } = data;

  // Use English-only fallback immediately; translations patched async below
  const initialNameTranslations = nameTranslations && Object.keys(nameTranslations).length > 0
    ? nameTranslations
    : { en: name };

  const initialDescTranslations =
    descriptionTranslations && Object.keys(descriptionTranslations).length > 0
      ? descriptionTranslations
      : description
      ? { en: description }
      : {};

  const result = await pool.query(
    `INSERT INTO menu_items
      (restaurant_id, category_id, name, name_translations, description, description_translations, price, image_url, is_available, dietary_tags, sort_order)
     VALUES
      ($1,            $2,          $3,   $4,                $5,          $6,                       $7,    $8,        $9,           $10,          $11)
     RETURNING id, category_id AS "categoryId", name, name_translations AS "nameTranslations", 
               description, description_translations AS "descriptionTranslations", price,
               image_url AS "imageUrl", is_available AS "isAvailable",
               dietary_tags AS "dietaryTags", sort_order AS "sortOrder"`,
    [
      restaurantId,
      categoryId,
      name,
      initialNameTranslations,
      description || null,
      initialDescTranslations,
      price,
      imageUrl || null,
      isAvailable,
      dietaryTags || null,
      sortOrder ?? null,
    ],
  );

  const item = result.rows[0];

  // Patch translations in background
  const asyncFields = {};
  if (!nameTranslations || Object.keys(nameTranslations).length === 0) asyncFields.name_translations = name;
  if (description && (!descriptionTranslations || Object.keys(descriptionTranslations).length === 0)) {
    asyncFields.description_translations = description;
  }
  if (Object.keys(asyncFields).length > 0) {
    translateAndPatchAsync('menu_items', 'id', item.id, asyncFields);
  }

  return item;
}

export async function updateMenuItem(restaurantId, itemId, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  const map = {
    categoryId: "category_id",
    name: "name",
    nameTranslations: "name_translations",
    description: "description",
    descriptionTranslations: "description_translations",
    price: "price",
    imageUrl: "image_url",
    isAvailable: "is_available",
    dietaryTags: "dietary_tags",
    sortOrder: "sort_order",
  };

  for (const [key, column] of Object.entries(map)) {
    if (data[key] !== undefined) {
      fields.push(`${column} = $${idx}`);
      values.push(data[key]);
      idx += 1;
    }
  }
  
  // Auto-translate if name/description changed but translations weren't explicitly provided (async, non-blocking)
  const asyncFields = {};
  if (data.name !== undefined && data.nameTranslations === undefined) asyncFields.name_translations = data.name;
  if (data.description !== undefined && data.descriptionTranslations === undefined) asyncFields.description_translations = data.description;

  if (!fields.length && Object.keys(asyncFields).length === 0) return null;
  // If only translations need updating (no other field change), do it fully async
  if (!fields.length) {
    translateAndPatchAsync('menu_items', 'id', itemId, asyncFields);
    return { id: itemId }; // Return minimal shape
  }

  values.push(restaurantId);
  values.push(itemId);

  const result = await pool.query(
    `UPDATE menu_items
     SET ${fields.join(", ")}, updated_at = now()
     WHERE restaurant_id = $${idx} AND id = $${idx + 1}
     RETURNING id, category_id AS "categoryId", name, name_translations AS "nameTranslations",
               description, description_translations AS "descriptionTranslations", price,
               image_url AS "imageUrl", is_available AS "isAvailable",
               dietary_tags AS "dietaryTags", sort_order AS "sortOrder"`,
    values,
  );
  const updatedItem = result.rows[0] || null;

  // Fire background translation if name/description changed without explicit translations
  if (updatedItem && Object.keys(asyncFields).length > 0) {
    translateAndPatchAsync('menu_items', 'id', updatedItem.id, asyncFields);
  }

  return updatedItem;
}

export async function deleteMenuItem(restaurantId, itemId) {
  // Soft delete instead of hard delete
  const result = await pool.query(
    `UPDATE menu_items
     SET is_active = false, updated_at = now()
     WHERE restaurant_id = $1 AND id = $2
     RETURNING id, is_active AS "isActive"`,
    [restaurantId, itemId],
  );
  return result.rows[0] || null;
}

export async function updateMenuItemImage(restaurantId, itemId, imageUrl) {
  const result = await pool.query(
    `UPDATE menu_items
     SET image_url = $1, updated_at = now()
     WHERE restaurant_id = $2 AND id = $3
     RETURNING id, image_url AS "imageUrl"`,
    [imageUrl, restaurantId, itemId],
  );
  return result.rows[0] || null;
}
export async function getMenuSuggestions(query = '', page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  let result;
  let countResult;

  if (query) {
    // Full-text search on name
    const tsQuery = query.trim().split(/\s+/).join(':* & ') + ':*';
    result = await pool.query(
      `SELECT id, name, description, price, image_url AS "imageUrl", category, dietary_tags AS "dietaryTags"
       FROM menu_suggestions
       WHERE to_tsvector('english', name) @@ to_tsquery('english', $1)
       ORDER BY name
       LIMIT $2 OFFSET $3`,
      [tsQuery, limit, offset]
    );
    countResult = await pool.query(
      `SELECT count(*)
       FROM menu_suggestions
       WHERE to_tsvector('english', name) @@ to_tsquery('english', $1)`,
      [tsQuery]
    );
  } else {
    // No search query, return all
    result = await pool.query(
      `SELECT id, name, description, price, image_url AS "imageUrl", category, dietary_tags AS "dietaryTags"
       FROM menu_suggestions
       ORDER BY name
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    countResult = await pool.query(`SELECT count(*) FROM menu_suggestions`);
  }

  const total = parseInt(countResult.rows[0].count, 10);
  return {
    items: result.rows,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + result.rows.length < total,
      currentPage: page,
      totalPages: Math.ceil(total / limit)
    }
  };
}
