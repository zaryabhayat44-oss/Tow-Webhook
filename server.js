import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ORS_API_KEY = process.env.ORS_API_KEY;

// ─── Pricing ───────────────────────────────────────────────────────────────
const PRICING = {
  light:  { hookFee: 149.97, label: "Light Duty" },
  medium: { hookFee: 222.49, label: "Medium Duty" },
  heavy:  { hookFee: 375.00, label: "Heavy Duty" },
};
const MILEAGE_RATE = 6.00;

// ─── Helper: Geocode address → [lng, lat] ──────────────────────────────────
async function geocode(address) {
  const res = await axios.get("https://api.openrouteservice.org/geocode/search", {
    params: { api_key: ORS_API_KEY, text: address, size: 1 },
  });
  const feature = res.data?.features?.[0];
  if (!feature) throw new Error(`Could not geocode: ${address}`);
  return feature.geometry.coordinates; // [lng, lat]
}

// ─── POST /quote ───────────────────────────────────────────────────────────
// GHL sends: { origin, destination, duty_class, vehicle }
// Returns:   { miles, hook_fee, mileage_cost, total, spoken_quote }
app.post("/quote", async (req, res) => {
  const { origin, destination, duty_class, vehicle } = req.body;

  if (!origin || !destination || !duty_class || !vehicle) {
    return res.status(400).json({ error: "Missing required fields: origin, destination, duty_class, vehicle" });
  }

  const tier = PRICING[duty_class.toLowerCase()];
  if (!tier) {
    return res.status(400).json({ error: "duty_class must be light, medium, or heavy" });
  }

  try {
    // Geocode both addresses
    const [originCoords, destCoords] = await Promise.all([
      geocode(origin),
      geocode(destination),
    ]);

    // Get road distance
    const routeRes = await axios.post(
      "https://api.openrouteservice.org/v2/directions/driving-car",
      { coordinates: [originCoords, destCoords] },
      { headers: { Authorization: ORS_API_KEY, "Content-Type": "application/json" } }
    );

    const summary = routeRes.data?.routes?.[0]?.summary;
    if (!summary) throw new Error("No route found between these addresses.");

    const miles = Math.ceil((summary.distance / 1609.344) * 10) / 10;
    const durationMin = Math.round(summary.duration / 60);
    const mileageCost = parseFloat((miles * MILEAGE_RATE).toFixed(2));
    const total = Math.round(tier.hookFee + mileageCost);

    const spoken_quote =
      `Alright, so for your ${vehicle} the hook fee is $${tier.hookFee.toFixed(2)}. ` +
      `The distance is ${miles} miles at $${MILEAGE_RATE} a mile, that's $${mileageCost.toFixed(2)}. ` +
      `So your total comes out to $${total}.`;

    return res.json({
      vehicle,
      duty_class: tier.label,
      hook_fee: tier.hookFee,
      miles,
      duration: `${durationMin} mins`,
      mileage_rate: MILEAGE_RATE,
      mileage_cost: mileageCost,
      total,
      spoken_quote,
    });

  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    return res.status(500).json({ error: detail });
  }
});

// ─── GET / health check ────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "Towco webhook running" });
});

app.listen(PORT, () => {
  console.log(`Towco webhook server running on port ${PORT}`);
});
