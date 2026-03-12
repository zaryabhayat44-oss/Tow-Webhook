# Towco Towing Webhook Server

HTTP webhook for GHL Voice AI. Accepts pickup/dropoff addresses, returns real road miles and a towing quote.

## Endpoint

### POST /quote

**Request body:**
```json
{
  "origin": "123 Main St, Dallas, TX",
  "destination": "456 Elm St, Fort Worth, TX",
  "duty_class": "light",
  "vehicle": "2019 Honda Civic"
}
```

**Response:**
```json
{
  "vehicle": "2019 Honda Civic",
  "duty_class": "Light Duty",
  "hook_fee": 149.97,
  "miles": 32.4,
  "duration": "38 mins",
  "mileage_rate": 6.00,
  "mileage_cost": 194.40,
  "total": 344,
  "spoken_quote": "Alright, so for your 2019 Honda Civic the hook fee is $149.97. The distance is 32.4 miles at $6 a mile, that's $194.40. So your total comes out to $344."
}
```

## duty_class values
- `light` — passenger cars, SUVs, standard pickups
- `medium` — box trucks, 1-ton duallies, large service trucks
- `heavy` — semis, buses, motorcoaches, large RVs

## Deploy to Railway
1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variable: ORS_API_KEY=your_key
4. Railway gives you a live URL like https://towco-webhook.up.railway.app
5. Use that URL in GHL as your webhook endpoint
