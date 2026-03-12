import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`, JSON.stringify(req.body || {}));
  next();
});

const PORT = process.env.PORT || 3000;
const ORS_API_KEY = process.env.ORS_API_KEY;
const BASE_URL = process.env.BASE_URL || "";

// ─── Pricing ───────────────────────────────────────────────────────────────
const PRICING = {
  light:  { hookFee: 149.97, label: "Light Duty" },
  medium: { hookFee: 222.49, label: "Medium Duty" },
  heavy:  { hookFee: 375.00, label: "Heavy Duty" },
};
const MILEAGE_RATE = 6.00;

// ─── MCP Tool Definitions ──────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_quote",
    description: "Calculates real road driving distance and returns an accurate towing quote. Call this once you have the pickup address, drop-off address, vehicle year/make/model, and duty class.",
    inputSchema: {
      type: "object",
      required: ["origin", "destination", "duty_class", "vehicle"],
      properties: {
        origin: {
          type: "string",
          description: "Full pickup address including city and state e.g. 123 Main St, Dallas, TX",
        },
        destination: {
          type: "string",
          description: "Full drop-off address including city and state e.g. 456 Elm St, Fort Worth, TX",
        },
        duty_class: {
          type: "string",
          enum: ["light", "medium", "heavy"],
          description: "light = passenger cars/SUVs/standard pickups, medium = box trucks/duallies, heavy = semis/buses/RVs",
        },
        vehicle: {
          type: "string",
          description: "Year make and model e.g. 2019 Honda Civic",
        },
      },
    },
  },
];

// ─── Helper: Geocode ───────────────────────────────────────────────────────
async function geocode(address) {
  const res = await axios.get("https://api.openrouteservice.org/geocode/search", {
    params: { api_key: ORS_API_KEY, text: address, size: 1 },
  });
  const feature = res.data?.features?.[0];
  if (!feature) throw new Error(`Could not geocode: ${address}`);
  return feature.geometry.coordinates;
}

// ─── Helper: Run get_quote ─────────────────────────────────────────────────
async function runGetQuote({ origin, destination, duty_class, vehicle }) {
  const tier = PRICING[duty_class.toLowerCase()];
  if (!tier) throw new Error("duty_class must be light, medium, or heavy");

  const [originCoords, destCoords] = await Promise.all([
    geocode(origin),
    geocode(destination),
  ]);

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

  return { vehicle, duty_class: tier.label, hook_fee: tier.hookFee, miles, duration: `${durationMin} mins`, mileage_rate: MILEAGE_RATE, mileage_cost: mileageCost, total, spoken_quote };
}

// ─── SSE clients ───────────────────────────────────────────────────────────
const clients = new Map();
let clientId = 0;

// ─── MCP: SSE endpoint ─────────────────────────────────────────────────────
app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const id = ++clientId;
  clients.set(id, res);

  console.log(`SSE client connected: ${id}`);

  // Use full absolute URL so GHL can POST back correctly
  const messageUrl = `${BASE_URL}/message?clientId=${id}`;
  console.log(`Sending endpoint URI: ${messageUrl}`);
  res.write(`event: endpoint\ndata: ${JSON.stringify({ uri: messageUrl })}\n\n`);

  // Keep alive ping every 15s
  const ping = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);

  req.on("close", () => {
    console.log(`SSE client disconnected: ${id}`);
    clients.delete(id);
    clearInterval(ping);
  });
});

// ─── MCP: Message endpoint ─────────────────────────────────────────────────
app.post("/message", async (req, res) => {
  const id = parseInt(req.query.clientId);
  const client = clients.get(id);
  const body = req.body;

  console.log(`Message from client ${id}:`, JSON.stringify(body));

  const { jsonrpc, id: rpcId, method, params } = body;

  const send = (payload) => {
    console.log(`Sending to client ${id}:`, JSON.stringify(payload));
    if (client) {
      client.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    }
    res.json({ status: "ok" });
  };

  if (method === "initialize") {
    return send({
      jsonrpc,
      id: rpcId,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "towco-mcp", version: "1.0.0" },
        capabilities: { tools: {} },
      },
    });
  }

  if (method === "notifications/initialized") {
    return res.json({ status: "ok" });
  }

  if (method === "tools/list") {
    return send({
      jsonrpc,
      id: rpcId,
      result: { tools: TOOLS },
    });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    try {
      let result;
      if (name === "get_quote") result = await runGetQuote(args);
      else throw new Error(`Unknown tool: ${name}`);

      return send({
        jsonrpc,
        id: rpcId,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      });
    } catch (err) {
      console.error("Tool error:", err.message);
      return send({
        jsonrpc,
        id: rpcId,
        result: {
          content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
          isError: true,
        },
      });
    }
  }

  console.log(`Unhandled method: ${method}`);
  res.json({ status: "ok" });
});

// ─── Health check ──────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "Towco MCP server running", base_url: BASE_URL }));

app.listen(PORT, () => console.log(`Towco MCP server running on port ${PORT}, BASE_URL: ${BASE_URL}`));
