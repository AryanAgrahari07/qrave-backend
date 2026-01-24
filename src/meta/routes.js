import express from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  listCountries,
  getCountryByCode,
  listStates,
  getStateByCode,
  listCities,
  getCityByCode,
  listCurrencies,
  getCurrencyByCode,
} from "./service.js";

const router = express.Router();

export function registerMetaRoutes(app) {
  // Countries
  router.get(
    "/countries",
    asyncHandler(async (req, res) => {
      const searchQuery = req.query.q || "";
      const countries = await listCountries(searchQuery);
      res.json({ countries });
    })
  );

  router.get(
    "/countries/:code",
    asyncHandler(async (req, res) => {
      const country = await getCountryByCode(req.params.code);
      if (!country) {
        return res.status(404).json({ message: "Country not found" });
      }
      res.json({ country });
    })
  );

  // States
  router.get(
    "/states",
    asyncHandler(async (req, res) => {
      const countryCode = req.query.country || null;
      const searchQuery = req.query.q || "";
      
      if (!countryCode) {
        return res.status(400).json({ 
          message: "Country code is required",
          states: [] 
        });
      }
      
      const states = await listStates(countryCode, searchQuery);
      res.json({ states });
    })
  );

  router.get(
    "/states/:code",
    asyncHandler(async (req, res) => {
      const state = await getStateByCode(req.params.code);
      if (!state) {
        return res.status(404).json({ message: "State not found" });
      }
      res.json({ state });
    })
  );

  // Cities
  router.get(
    "/cities",
    asyncHandler(async (req, res) => {
      const stateCode = req.query.state || null;
      const searchQuery = req.query.q || "";
      
      if (!stateCode) {
        return res.status(400).json({ 
          message: "State code is required",
          cities: [] 
        });
      }
      
      const cities = await listCities(stateCode, searchQuery);
      res.json({ cities });
    })
  );

  router.get(
    "/cities/:code",
    asyncHandler(async (req, res) => {
      const city = await getCityByCode(req.params.code);
      if (!city) {
        return res.status(404).json({ message: "City not found" });
      }
      res.json({ city });
    })
  );

  // Currencies
  router.get(
    "/currencies",
    asyncHandler(async (req, res) => {
      const searchQuery = req.query.q || "";
      const currencies = await listCurrencies(searchQuery);
      res.json({ currencies });
    })
  );

  router.get(
    "/currencies/:code",
    asyncHandler(async (req, res) => {
      const currency = await getCurrencyByCode(req.params.code);
      if (!currency) {
        return res.status(404).json({ message: "Currency not found" });
      }
      res.json({ currency });
    })
  );

  app.use("/api/meta", router);
}