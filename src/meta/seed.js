// Seed file to populate meta tables with initial data
// Run this after creating the tables: node src/meta/seed.js

import { createPgPool } from "../db.js";
import { env } from "../config/env.js";

const pool = createPgPool(env.databaseUrl);

async function seedMetaData() {
  console.log("Seeding meta data...");

  try {
    // Seed Countries
    const countryData = [
      { code: "IN", name: "India" },
      { code: "US", name: "United States" },
      { code: "GB", name: "United Kingdom" },
      { code: "AU", name: "Australia" },
      { code: "CA", name: "Canada" },
      { code: "AE", name: "United Arab Emirates" },
      { code: "SG", name: "Singapore" },
      { code: "MY", name: "Malaysia" },
      { code: "TH", name: "Thailand" },
      { code: "JP", name: "Japan" },
    ];

    for (const country of countryData) {
      await pool.query(
        `INSERT INTO countries (code, name) 
         VALUES ($1, $2) 
         ON CONFLICT (code) DO NOTHING`,
        [country.code, country.name]
      );
    }
    console.log("✓ Countries seeded");

    // Seed Indian States
    const indianStates = [
      { code: "IN-MP", name: "Madhya Pradesh", countryCode: "IN" },
      { code: "IN-MH", name: "Maharashtra", countryCode: "IN" },
      { code: "IN-DL", name: "Delhi", countryCode: "IN" },
      { code: "IN-KA", name: "Karnataka", countryCode: "IN" },
      { code: "IN-TN", name: "Tamil Nadu", countryCode: "IN" },
      { code: "IN-UP", name: "Uttar Pradesh", countryCode: "IN" },
      { code: "IN-GJ", name: "Gujarat", countryCode: "IN" },
      { code: "IN-RJ", name: "Rajasthan", countryCode: "IN" },
      { code: "IN-WB", name: "West Bengal", countryCode: "IN" },
      { code: "IN-HR", name: "Haryana", countryCode: "IN" },
      { code: "IN-PB", name: "Punjab", countryCode: "IN" },
      { code: "IN-AP", name: "Andhra Pradesh", countryCode: "IN" },
      { code: "IN-TG", name: "Telangana", countryCode: "IN" },
      { code: "IN-KL", name: "Kerala", countryCode: "IN" },
      { code: "IN-OR", name: "Odisha", countryCode: "IN" },
      { code: "IN-JH", name: "Jharkhand", countryCode: "IN" },
      { code: "IN-AS", name: "Assam", countryCode: "IN" },
      { code: "IN-BR", name: "Bihar", countryCode: "IN" },
      { code: "IN-CG", name: "Chhattisgarh", countryCode: "IN" },
      { code: "IN-GA", name: "Goa", countryCode: "IN" },
    ];

    for (const state of indianStates) {
      await pool.query(
        `INSERT INTO states (code, name, country_code) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (code) DO NOTHING`,
        [state.code, state.name, state.countryCode]
      );
    }
    console.log("✓ Indian states seeded");

    // Seed major Indian cities
    const indianCities = [
      // Madhya Pradesh
      { code: "IN-MP:Bhopal", name: "Bhopal", stateCode: "IN-MP" },
      { code: "IN-MP:Indore", name: "Indore", stateCode: "IN-MP" },
      { code: "IN-MP:Gwalior", name: "Gwalior", stateCode: "IN-MP" },
      { code: "IN-MP:Jabalpur", name: "Jabalpur", stateCode: "IN-MP" },
      { code: "IN-MP:Ujjain", name: "Ujjain", stateCode: "IN-MP" },
      
      // Maharashtra
      { code: "IN-MH:Mumbai", name: "Mumbai", stateCode: "IN-MH" },
      { code: "IN-MH:Pune", name: "Pune", stateCode: "IN-MH" },
      { code: "IN-MH:Nagpur", name: "Nagpur", stateCode: "IN-MH" },
      { code: "IN-MH:Nashik", name: "Nashik", stateCode: "IN-MH" },
      { code: "IN-MH:Aurangabad", name: "Aurangabad", stateCode: "IN-MH" },
      
      // Delhi
      { code: "IN-DL:NewDelhi", name: "New Delhi", stateCode: "IN-DL" },
      { code: "IN-DL:Delhi", name: "Delhi", stateCode: "IN-DL" },
      
      // Karnataka
      { code: "IN-KA:Bangalore", name: "Bangalore", stateCode: "IN-KA" },
      { code: "IN-KA:Mysore", name: "Mysore", stateCode: "IN-KA" },
      { code: "IN-KA:Mangalore", name: "Mangalore", stateCode: "IN-KA" },
      
      // Tamil Nadu
      { code: "IN-TN:Chennai", name: "Chennai", stateCode: "IN-TN" },
      { code: "IN-TN:Coimbatore", name: "Coimbatore", stateCode: "IN-TN" },
      { code: "IN-TN:Madurai", name: "Madurai", stateCode: "IN-TN" },
      
      // Uttar Pradesh
      { code: "IN-UP:Lucknow", name: "Lucknow", stateCode: "IN-UP" },
      { code: "IN-UP:Kanpur", name: "Kanpur", stateCode: "IN-UP" },
      { code: "IN-UP:Agra", name: "Agra", stateCode: "IN-UP" },
      { code: "IN-UP:Varanasi", name: "Varanasi", stateCode: "IN-UP" },
      
      // Gujarat
      { code: "IN-GJ:Ahmedabad", name: "Ahmedabad", stateCode: "IN-GJ" },
      { code: "IN-GJ:Surat", name: "Surat", stateCode: "IN-GJ" },
      { code: "IN-GJ:Vadodara", name: "Vadodara", stateCode: "IN-GJ" },
      
      // West Bengal
      { code: "IN-WB:Kolkata", name: "Kolkata", stateCode: "IN-WB" },
      
      // Telangana
      { code: "IN-TG:Hyderabad", name: "Hyderabad", stateCode: "IN-TG" },
      
      // Kerala
      { code: "IN-KL:Kochi", name: "Kochi", stateCode: "IN-KL" },
      { code: "IN-KL:Thiruvananthapuram", name: "Thiruvananthapuram", stateCode: "IN-KL" },
    ];

    for (const city of indianCities) {
      await pool.query(
        `INSERT INTO cities (code, name, state_code) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (code) DO NOTHING`,
        [city.code, city.name, city.stateCode]
      );
    }
    console.log("✓ Indian cities seeded");

    // Seed Currencies
    const currencyData = [
      { code: "INR", name: "Indian Rupee", symbol: "₹" },
      { code: "USD", name: "US Dollar", symbol: "$" },
      { code: "EUR", name: "Euro", symbol: "€" },
      { code: "GBP", name: "British Pound", symbol: "£" },
      { code: "AUD", name: "Australian Dollar", symbol: "A$" },
      { code: "CAD", name: "Canadian Dollar", symbol: "C$" },
      { code: "AED", name: "UAE Dirham", symbol: "د.إ" },
      { code: "SGD", name: "Singapore Dollar", symbol: "S$" },
      { code: "MYR", name: "Malaysian Ringgit", symbol: "RM" },
      { code: "THB", name: "Thai Baht", symbol: "฿" },
      { code: "JPY", name: "Japanese Yen", symbol: "¥" },
    ];

    for (const currency of currencyData) {
      await pool.query(
        `INSERT INTO currencies (code, name, symbol) 
         VALUES ($1, $2, $3) 
         ON CONFLICT (code) DO NOTHING`,
        [currency.code, currency.name, currency.symbol]
      );
    }
    console.log("✓ Currencies seeded");

    console.log("\n✅ Meta data seeding complete!");
  } catch (error) {
    console.error("❌ Seed failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the seed function
seedMetaData()
  .then(() => {
    console.log("Seed completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Seed error:", error);
    process.exit(1);
  });