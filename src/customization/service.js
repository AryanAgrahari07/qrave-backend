import { pool } from "../dbClient.js";

// ============================================
// VARIANTS - Size/Portion Management
// ============================================

export async function getVariantsForMenuItem(menuItemId) {
  const result = await pool.query(
    `SELECT id, variant_name AS "variantName", 
            price,
            is_default AS "isDefault",
            is_available AS "isAvailable",
            sort_order AS "sortOrder"
     FROM menu_item_variants
     WHERE menu_item_id = $1
     ORDER BY sort_order NULLS LAST, variant_name ASC`,
    [menuItemId]
  );
  return result.rows;
}

export async function createVariant(restaurantId, menuItemId, data) {
  const { variantName, price, isDefault = false, sortOrder } = data;
  
  const result = await pool.query(
    `INSERT INTO menu_item_variants 
      (restaurant_id, menu_item_id, variant_name, price, is_default, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, variant_name AS "variantName", 
               price,
               is_default AS "isDefault",
               is_available AS "isAvailable"`,
    [restaurantId, menuItemId, variantName, price, isDefault, sortOrder ?? null]
  );
  
  return result.rows[0];
}

export async function updateVariant(restaurantId, variantId, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (data.variantName !== undefined) {
    fields.push(`variant_name = $${idx++}`);
    values.push(data.variantName);
  }
  if (data.price !== undefined) {
    fields.push(`price = $${idx++}`);
    values.push(data.price);
  }
  if (data.isDefault !== undefined) {
    fields.push(`is_default = $${idx++}`);
    values.push(data.isDefault);
  }
  if (data.isAvailable !== undefined) {
    fields.push(`is_available = $${idx++}`);
    values.push(data.isAvailable);
  }
  if (data.sortOrder !== undefined) {
    fields.push(`sort_order = $${idx++}`);
    values.push(data.sortOrder);
  }

  if (!fields.length) return null;

  values.push(restaurantId, variantId);

  const result = await pool.query(
    `UPDATE menu_item_variants
     SET ${fields.join(", ")}, updated_at = now()
     WHERE restaurant_id = $${idx} AND id = $${idx + 1}
     RETURNING id, variant_name AS "variantName", 
               price,
               is_default AS "isDefault",
               is_available AS "isAvailable"`,
    values
  );
  
  return result.rows[0] || null;
}

export async function deleteVariant(restaurantId, variantId) {
  const result = await pool.query(
    `DELETE FROM menu_item_variants
     WHERE restaurant_id = $1 AND id = $2
     RETURNING id`,
    [restaurantId, variantId]
  );
  return result.rows[0] || null;
}

// ============================================
// MODIFIER GROUPS - Managing customization groups
// ============================================

export async function getModifierGroups(restaurantId) {
  const result = await pool.query(
    `SELECT id, name, description,
            selection_type AS "selectionType",
            min_selections AS "minSelections",
            max_selections AS "maxSelections",
            is_required AS "isRequired",
            is_active AS "isActive",
            sort_order AS "sortOrder"
     FROM modifier_groups
     WHERE restaurant_id = $1 AND is_active = true
     ORDER BY sort_order NULLS LAST, name ASC`,
    [restaurantId]
  );
  return result.rows;
}

export async function createModifierGroup(restaurantId, data) {
  const {
    name,
    description,
    selectionType = 'MULTIPLE',
    minSelections = 0,
    maxSelections,
    isRequired = false,
    sortOrder
  } = data;
  
  const result = await pool.query(
    `INSERT INTO modifier_groups 
      (restaurant_id, name, description, selection_type, min_selections, 
       max_selections, is_required, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, description,
               selection_type AS "selectionType",
               min_selections AS "minSelections",
               max_selections AS "maxSelections",
               is_required AS "isRequired",
               is_active AS "isActive"`,
    [restaurantId, name, description || null, selectionType, minSelections, 
     maxSelections ?? null, isRequired, sortOrder ?? null]
  );
  
  return result.rows[0];
}

export async function updateModifierGroup(restaurantId, groupId, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  const fieldMap = {
    name: "name",
    description: "description",
    selectionType: "selection_type",
    minSelections: "min_selections",
    maxSelections: "max_selections",
    isRequired: "is_required",
    isActive: "is_active",
    sortOrder: "sort_order",
  };

  for (const [key, column] of Object.entries(fieldMap)) {
    if (data[key] !== undefined) {
      fields.push(`${column} = $${idx}`);
      values.push(data[key]);
      idx++;
    }
  }

  if (!fields.length) return null;

  values.push(restaurantId, groupId);

  const result = await pool.query(
    `UPDATE modifier_groups
     SET ${fields.join(", ")}, updated_at = now()
     WHERE restaurant_id = $${idx} AND id = $${idx + 1}
     RETURNING id, name, description,
               selection_type AS "selectionType",
               min_selections AS "minSelections",
               max_selections AS "maxSelections",
               is_required AS "isRequired",
               is_active AS "isActive"`,
    values
  );
  
  return result.rows[0] || null;
}

export async function deleteModifierGroup(restaurantId, groupId) {
  const result = await pool.query(
    `UPDATE modifier_groups
     SET is_active = false, updated_at = now()
     WHERE restaurant_id = $1 AND id = $2
     RETURNING id`,
    [restaurantId, groupId]
  );
  return result.rows[0] || null;
}

// ============================================
// MODIFIERS - Individual customization options
// ============================================

export async function getModifiersForGroup(modifierGroupId) {
  const result = await pool.query(
    `SELECT id, name, price,
            is_default AS "isDefault",
            is_available AS "isAvailable",
            sort_order AS "sortOrder"
     FROM modifiers
     WHERE modifier_group_id = $1
     ORDER BY sort_order NULLS LAST, name ASC`,
    [modifierGroupId]
  );
  return result.rows;
}

export async function createModifier(restaurantId, modifierGroupId, data) {
  const { name, price = 0, isDefault = false, sortOrder } = data;
  
  const result = await pool.query(
    `INSERT INTO modifiers 
      (restaurant_id, modifier_group_id, name, price, is_default, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, price,
               is_default AS "isDefault",
               is_available AS "isAvailable"`,
    [restaurantId, modifierGroupId, name, price, isDefault, sortOrder ?? null]
  );
  
  return result.rows[0];
}

export async function updateModifier(restaurantId, modifierId, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  const fieldMap = {
    name: "name",
    price: "price",
    isDefault: "is_default",
    isAvailable: "is_available",
    sortOrder: "sort_order",
  };

  for (const [key, column] of Object.entries(fieldMap)) {
    if (data[key] !== undefined) {
      fields.push(`${column} = $${idx}`);
      values.push(data[key]);
      idx++;
    }
  }

  if (!fields.length) return null;

  values.push(restaurantId, modifierId);

  const result = await pool.query(
    `UPDATE modifiers
     SET ${fields.join(", ")}, updated_at = now()
     WHERE restaurant_id = $${idx} AND id = $${idx + 1}
     RETURNING id, name, price,
               is_default AS "isDefault",
               is_available AS "isAvailable"`,
    values
  );
  
  return result.rows[0] || null;
}

export async function deleteModifier(restaurantId, modifierId) {
  const result = await pool.query(
    `DELETE FROM modifiers
     WHERE restaurant_id = $1 AND id = $2
     RETURNING id`,
    [restaurantId, modifierId]
  );
  return result.rows[0] || null;
}

// ============================================
// MENU ITEM MODIFIER GROUPS - Linking items to modifier groups
// ============================================

export async function getModifierGroupsForMenuItem(menuItemId) {
  const result = await pool.query(
    `SELECT 
       mg.id,
       mg.name,
       mg.description,
       mg.selection_type AS "selectionType",
       mg.min_selections AS "minSelections",
       mg.max_selections AS "maxSelections",
       mg.is_required AS "isRequired",
       mimg.sort_order AS "sortOrder"
     FROM modifier_groups mg
     JOIN menu_item_modifier_groups mimg ON mg.id = mimg.modifier_group_id
     WHERE mimg.menu_item_id = $1 AND mg.is_active = true
     ORDER BY mimg.sort_order NULLS LAST, mg.name ASC`,
    [menuItemId]
  );
  
  // Get modifiers for each group
  const groups = await Promise.all(
    result.rows.map(async (group) => {
      const modifiers = await getModifiersForGroup(group.id);
      return {
        ...group,
        modifiers
      };
    })
  );
  
  return groups;
}

export async function linkModifierGroupToMenuItem(
  menuItemId, 
  modifierGroupId,
  sortOrder
) {
  // First, check if the link already exists
  const existingLink = await pool.query(
    `SELECT id, sort_order 
     FROM menu_item_modifier_groups 
     WHERE menu_item_id = $1 AND modifier_group_id = $2`,
    [menuItemId, modifierGroupId]
  );

  // If link exists, update the sort order
  if (existingLink.rows.length > 0) {
    const result = await pool.query(
      `UPDATE menu_item_modifier_groups 
       SET sort_order = $1
       WHERE menu_item_id = $2 AND modifier_group_id = $3
       RETURNING id`,
      [sortOrder ?? null, menuItemId, modifierGroupId]
    );
    return result.rows[0];
  }

  // If link doesn't exist, create it
  const result = await pool.query(
    `INSERT INTO menu_item_modifier_groups 
      (menu_item_id, modifier_group_id, sort_order)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [menuItemId, modifierGroupId, sortOrder ?? null]
  );
  
  return result.rows[0];
}


export async function unlinkModifierGroupFromMenuItem(
  menuItemId,
  modifierGroupId
) {
  const result = await pool.query(
    `DELETE FROM menu_item_modifier_groups
     WHERE menu_item_id = $1 AND modifier_group_id = $2
     RETURNING id`,
    [menuItemId, modifierGroupId]
  );
  
  return result.rows[0] || null;
}

// ============================================
// ENHANCED MENU RETRIEVAL - Include variants and modifiers
// ============================================

export async function getMenuForRestaurantWithCustomizations(
  restaurantId, 
  dietaryFilter = null
) {
  // Acquire a single client for the entire operation
  const client = await pool.connect();
  
  try {
    // Get categories
    const categoriesResult = await client.query(
      `SELECT id, name, sort_order AS "sortOrder"
       FROM menu_categories
       WHERE restaurant_id = $1 AND is_active = true
       ORDER BY sort_order NULLS LAST, name ASC`,
      [restaurantId]
    );

    // Build items query with dietary filter
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
    
    if (dietaryFilter === 'veg') {
      itemsQuery += ` AND 'Veg' = ANY(dietary_tags)`;
    } else if (dietaryFilter === 'non-veg') {
      itemsQuery += ` AND 'Non-Veg' = ANY(dietary_tags)`;
    }
    
    itemsQuery += ` ORDER BY sort_order NULLS LAST, name ASC`;
    
    const itemsResult = await client.query(itemsQuery, queryParams);
    const items = itemsResult.rows;

    // If no items, return early
    if (items.length === 0) {
      return {
        categories: categoriesResult.rows,
        items: []
      };
    }

    // === BATCH QUERY 1: Fetch ALL variants for ALL items in one query ===
    const itemIds = items.map(item => item.id);
    const variantsResult = await client.query(
      `SELECT id, menu_item_id AS "menuItemId", variant_name AS "variantName", 
              price, is_default AS "isDefault", is_available AS "isAvailable",
              sort_order AS "sortOrder"
       FROM menu_item_variants
       WHERE menu_item_id = ANY($1)
       ORDER BY menu_item_id, sort_order NULLS LAST, variant_name ASC`,
      [itemIds]
    );

    // Group variants by menu item ID
    const variantsByItem = variantsResult.rows.reduce((acc, variant) => {
      if (!acc[variant.menuItemId]) {
        acc[variant.menuItemId] = [];
      }
      acc[variant.menuItemId].push(variant);
      return acc;
    }, {});

    // === BATCH QUERY 2: Fetch ALL modifier group links for ALL items ===
    const groupLinksResult = await client.query(
      `SELECT 
         mg.id,
         mg.name,
         mg.description,
         mg.selection_type AS "selectionType",
         mg.min_selections AS "minSelections",
         mg.max_selections AS "maxSelections",
         mg.is_required AS "isRequired",
         mimg.menu_item_id AS "menuItemId",
         mimg.sort_order AS "sortOrder"
       FROM modifier_groups mg
       JOIN menu_item_modifier_groups mimg ON mg.id = mimg.modifier_group_id
       WHERE mimg.menu_item_id = ANY($1) AND mg.is_active = true
       ORDER BY mimg.menu_item_id, mimg.sort_order NULLS LAST, mg.name ASC`,
      [itemIds]
    );

    const groups = groupLinksResult.rows;
    
    // === BATCH QUERY 3: Fetch ALL modifiers for ALL groups in one query ===
    let modifiersByGroup = {};
    if (groups.length > 0) {
      const groupIds = [...new Set(groups.map(g => g.id))]; // Unique group IDs
      const modifiersResult = await client.query(
        `SELECT id, modifier_group_id AS "modifierGroupId", name, price,
                is_default AS "isDefault", is_available AS "isAvailable",
                sort_order AS "sortOrder"
         FROM modifiers
         WHERE modifier_group_id = ANY($1)
         ORDER BY modifier_group_id, sort_order NULLS LAST, name ASC`,
        [groupIds]
      );

      modifiersByGroup = modifiersResult.rows.reduce((acc, mod) => {
        if (!acc[mod.modifierGroupId]) {
          acc[mod.modifierGroupId] = [];
        }
        acc[mod.modifierGroupId].push(mod);
        return acc;
      }, {});
    }

    // Attach modifiers to groups and group by menu item
    const groupsByItem = groups.reduce((acc, group) => {
      if (!acc[group.menuItemId]) {
        acc[group.menuItemId] = [];
      }
      acc[group.menuItemId].push({
        id: group.id,
        name: group.name,
        description: group.description,
        selectionType: group.selectionType,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        isRequired: group.isRequired,
        sortOrder: group.sortOrder,
        modifiers: modifiersByGroup[group.id] || []
      });
      return acc;
    }, {});

    // Attach variants and modifier groups to items
    const enhancedItems = items.map(item => ({
      ...item,
      variants: variantsByItem[item.id] || [],
      modifierGroups: groupsByItem[item.id] || []
    }));

    return {
      categories: categoriesResult.rows,
      items: enhancedItems,
    };
    
  } finally {
    // Always release the client back to the pool
    client.release();
  }
}