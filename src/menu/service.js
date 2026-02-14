import { pool } from "../dbClient.js";

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
            google_maps_link AS "googleMapsLink"
     FROM restaurants
     WHERE slug = $1 AND is_active = true`,
    [slug],
  );
  return result.rows[0] || null;
}

export async function getMenuForRestaurant(restaurantId, dietaryFilter = null) {
  const categoriesResult = await pool.query(
    `SELECT id, name, sort_order AS "sortOrder"
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
            description,
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
  const { name, sortOrder } = data;
  const result = await pool.query(
    `INSERT INTO menu_categories (restaurant_id, name, sort_order, is_active)
     VALUES ($1, $2, $3, true)
     RETURNING id, name, sort_order AS "sortOrder", is_active AS "isActive"`,
    [restaurantId, name, sortOrder ?? null],
  );
  return result.rows[0];
}

export async function updateCategory(restaurantId, categoryId, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (data.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(data.name);
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
     RETURNING id, name, sort_order AS "sortOrder", is_active AS "isActive"`,
    values,
  );
  return result.rows[0] || null;
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
    description,
    price,
    imageUrl,
    isAvailable = true,
    dietaryTags,
    sortOrder,
  } = data;

  const result = await pool.query(
    `INSERT INTO menu_items
      (restaurant_id, category_id, name, description, price, image_url, is_available, dietary_tags, sort_order)
     VALUES
      ($1,            $2,          $3,   $4,         $5,    $6,       $7,           $8,           $9)
     RETURNING id, category_id AS "categoryId", name, description, price,
               image_url AS "imageUrl", is_available AS "isAvailable",
               dietary_tags AS "dietaryTags", sort_order AS "sortOrder"`,
    [
      restaurantId,
      categoryId,
      name,
      description || null,
      price,
      imageUrl || null,
      isAvailable,
      dietaryTags || null,
      sortOrder ?? null,
    ],
  );

  return result.rows[0];
}

export async function updateMenuItem(restaurantId, itemId, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  const map = {
    categoryId: "category_id",
    name: "name",
    description: "description",
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

  if (!fields.length) return null;

  values.push(restaurantId);
  values.push(itemId);

  const result = await pool.query(
    `UPDATE menu_items
     SET ${fields.join(", ")}, updated_at = now()
     WHERE restaurant_id = $${idx} AND id = $${idx + 1}
     RETURNING id, category_id AS "categoryId", name, description, price,
               image_url AS "imageUrl", is_available AS "isAvailable",
               dietary_tags AS "dietaryTags", sort_order AS "sortOrder"`,
    values,
  );
  return result.rows[0] || null;
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


