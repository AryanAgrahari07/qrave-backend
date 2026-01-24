import { createPgPool } from "../db.js";
import { env } from "../config/env.js";

const pool = createPgPool(env.databaseUrl);

// Countries
export async function listCountries(searchQuery = "") {
  const query = searchQuery.trim().toLowerCase();
  
  const result = await pool.query(
    `SELECT code, name
     FROM countries
     WHERE LOWER(name) LIKE $1 OR LOWER(code) LIKE $1
     ORDER BY name ASC
     LIMIT 100`,
    [`%${query}%`]
  );
  
  return result.rows;
}

export async function getCountryByCode(code) {
  const result = await pool.query(
    `SELECT code, name
     FROM countries
     WHERE code = $1`,
    [code]
  );
  
  return result.rows[0] || null;
}

// States
export async function listStates(countryCode = null, searchQuery = "") {
  const query = searchQuery.trim().toLowerCase();
  
  if (!countryCode) {
    return [];
  }
  
  const result = await pool.query(
    `SELECT code, name, country_code AS "countryCode"
     FROM states
     WHERE country_code = $1 
       AND (LOWER(name) LIKE $2 OR LOWER(code) LIKE $2)
     ORDER BY name ASC
     LIMIT 100`,
    [countryCode, `%${query}%`]
  );
  
  return result.rows;
}

export async function getStateByCode(code) {
  const result = await pool.query(
    `SELECT code, name, country_code AS "countryCode"
     FROM states
     WHERE code = $1`,
    [code]
  );
  
  return result.rows[0] || null;
}

// Cities
export async function listCities(stateCode = null, searchQuery = "") {
  const query = searchQuery.trim().toLowerCase();
  
  if (!stateCode) {
    return [];
  }
  
  const result = await pool.query(
    `SELECT code, name, state_code AS "stateCode"
     FROM cities
     WHERE state_code = $1 
       AND LOWER(name) LIKE $2
     ORDER BY name ASC
     LIMIT 100`,
    [stateCode, `%${query}%`]
  );
  
  return result.rows;
}

export async function getCityByCode(code) {
  const result = await pool.query(
    `SELECT code, name, state_code AS "stateCode"
     FROM cities
     WHERE code = $1`,
    [code]
  );
  
  return result.rows[0] || null;
}

// Currencies
export async function listCurrencies(searchQuery = "") {
  const query = searchQuery.trim().toLowerCase();
  
  const result = await pool.query(
    `SELECT code, name, symbol
     FROM currencies
     WHERE LOWER(name) LIKE $1 
        OR LOWER(code) LIKE $1 
        OR LOWER(symbol) LIKE $1
     ORDER BY name ASC
     LIMIT 100`,
    [`%${query}%`]
  );
  
  return result.rows;
}

export async function getCurrencyByCode(code) {
  const result = await pool.query(
    `SELECT code, name, symbol
     FROM currencies
     WHERE code = $1`,
    [code]
  );
  
  return result.rows[0] || null;
}