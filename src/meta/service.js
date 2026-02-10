import { Country, State, City } from 'country-state-city';

// Countries
export async function listCountries(searchQuery = "") {
  const query = searchQuery.trim().toLowerCase();
  
  let countries = Country.getAllCountries();
  
  if (query) {
    countries = countries.filter(c => 
      c.name.toLowerCase().includes(query) || 
      c.isoCode.toLowerCase().includes(query)
    );
  }
  
  return countries.map(c => ({
    code: c.isoCode,
    name: c.name
  }));
}

export async function getCountryByCode(code) {
  const country = Country.getCountryByCode(code);
  
  if (!country) return null;
  
  return {
    code: country.isoCode,
    name: country.name
  };
}

// States
export async function listStates(countryCode = null, searchQuery = "") {
  const query = searchQuery.trim().toLowerCase();
  
  if (!countryCode) {
    return [];
  }
  
  let states = State.getStatesOfCountry(countryCode);
  
  if (query) {
    states = states.filter(s => 
      s.name.toLowerCase().includes(query) || 
      s.isoCode.toLowerCase().includes(query)
    );
  }
  
  // Return the state isoCode (e.g., "MP")
  return states.map(s => ({
    code: s.isoCode,
    name: s.name,
    countryCode: s.countryCode
  }));
}

export async function getStateByCode(code) {
  // Search across all countries to find the state
  const allCountries = Country.getAllCountries();
  
  for (const country of allCountries) {
    const states = State.getStatesOfCountry(country.isoCode);
    const state = states.find(s => s.isoCode === code);
    
    if (state) {
      return {
        code: state.isoCode,
        name: state.name,
        countryCode: state.countryCode
      };
    }
  }
  
  return null;
}

// Cities - SIMPLIFIED VERSION WITH BOTH COUNTRY AND STATE CODES
export async function listCities(countryCode, stateCode, searchQuery = "") {
  const query = searchQuery.trim().toLowerCase();
  
  if (!countryCode || !stateCode) {
    return [];
  }
  
  // Direct lookup - much faster!
  let cities = City.getCitiesOfState(countryCode, stateCode);
  
  if (query) {
    cities = cities.filter(c => 
      c.name.toLowerCase().includes(query)
    );
  }
  
  // Map to your existing format
  return cities.map(c => ({
    code: `${stateCode}:${c.name}`,
    name: c.name,
    stateCode: stateCode
  }));
}

export async function getCityByCode(code) {
  // Parse code format "MP:Indore"
  const parts = code.split(':');
  if (parts.length !== 2) return null;
  
  const [stateCode, cityName] = parts;
  
  // We need to find the country for this state
  const allCountries = Country.getAllCountries();
  
  for (const country of allCountries) {
    const states = State.getStatesOfCountry(country.isoCode);
    const matchingState = states.find(s => s.isoCode === stateCode);
    
    if (matchingState) {
      const cities = City.getCitiesOfState(country.isoCode, matchingState.isoCode);
      const city = cities.find(c => c.name === cityName);
      
      if (city) {
        return {
          code: code,
          name: city.name,
          stateCode: stateCode
        };
      }
    }
  }
  
  return null;
}

// Currencies
const CURRENCIES = [
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

export async function listCurrencies(searchQuery = "") {
  const query = searchQuery.trim().toLowerCase();
  
  if (!query) return CURRENCIES;
  
  return CURRENCIES.filter(c => 
    c.name.toLowerCase().includes(query) ||
    c.code.toLowerCase().includes(query) ||
    c.symbol.toLowerCase().includes(query)
  );
}

export async function getCurrencyByCode(code) {
  return CURRENCIES.find(c => c.code === code) || null;
}