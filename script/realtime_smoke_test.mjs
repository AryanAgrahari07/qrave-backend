import WebSocket from "ws";

const API_BASE = "http://localhost:3001";
const WS_URL = "ws://localhost:3001/ws";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(method, path, token, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.message || res.statusText || "Request failed";
    throw new Error(`${method} ${path} -> ${res.status}: ${msg}`);
  }
  return json;
}

function randSlug(prefix = "rt") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function main() {
  // 1) Create dev user -> token
  const email = `${randSlug("user")}@example.com`;
  const password = "password123";
  const reg = await api("POST", "/api/auth/register", null, {
    email,
    password,
    fullName: "Realtime Tester",
    role: "owner",
  });
  const token = reg.token;
  if (!token) throw new Error("No token returned from /api/auth/register");

  // 2) Create restaurant
  const slug = randSlug("restaurant");
  const createdRestaurant = await api("POST", "/api/restaurants", token, {
    name: `Realtime Test ${slug}`,
    slug,
    currency: "₹",
    plan: "STARTER",
  });
  const restaurantId = createdRestaurant?.restaurant?.id;
  if (!restaurantId) throw new Error("No restaurant.id returned");

  // 3) Connect WS and join restaurant room
  const events = [];
  const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);

  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === "event") {
        events.push(msg);
        // eslint-disable-next-line no-console
        console.log("[event]", msg.event);
      }
    } catch {
      // ignore
    }
  });

  ws.send(JSON.stringify({ type: "join", restaurantId }));
  await sleep(150);

  // 4) Create table + status change
  const createdTable = await api("POST", `/api/restaurants/${restaurantId}/tables`, token, {
    tableNumber: "T1",
    capacity: 4,
    qrCodePayload: `qr:${restaurantId}:T1`,
    currentStatus: "AVAILABLE",
  });
  const tableId = createdTable?.table?.id;
  if (!tableId) throw new Error("No table.id returned");

  await api("PATCH", `/api/restaurants/${restaurantId}/tables/${tableId}/status`, token, {
    status: "OCCUPIED",
  });

  // 5) Create category + item + order lifecycle
  const cat = await api("POST", `/api/menu/${restaurantId}/categories`, token, {
    name: "Starters",
    sortOrder: 1,
  });
  const categoryId = cat?.category?.id;
  if (!categoryId) throw new Error("No category.id returned");

  const item = await api("POST", `/api/menu/${restaurantId}/items`, token, {
    categoryId,
    name: "Paneer Tikka",
    description: "Smoky, spicy, delicious.",
    price: 199,
    isAvailable: true,
  });
  const menuItemId = item?.item?.id;
  if (!menuItemId) throw new Error("No item.id returned");

  const order = await api("POST", `/api/restaurants/${restaurantId}/orders`, token, {
    tableId,
    orderType: "DINE_IN",
    items: [{ menuItemId, quantity: 1 }],
  });
  const orderId = order?.order?.id;
  if (!orderId) throw new Error("No order.id returned");

  await api("PATCH", `/api/restaurants/${restaurantId}/orders/${orderId}/status`, token, {
    status: "PREPARING",
  });

  await api("POST", `/api/restaurants/${restaurantId}/orders/${orderId}/items`, token, {
    items: [{ menuItemId, quantity: 1 }],
  });

  // 6) Queue lifecycle (public register + protected status + seat)
  const q = await api("POST", `/api/queue/register/${restaurantId}`, null, {
    guestName: "Guest One",
    partySize: 2,
    phoneNumber: "9999999999",
  });
  const queueId = q?.entry?.id;
  if (!queueId) throw new Error("No queue entry id returned");

  await api("PATCH", `/api/restaurants/${restaurantId}/queue/${queueId}/status`, token, {
    status: "CALLED",
  });

  await api("POST", `/api/restaurants/${restaurantId}/queue/${queueId}/seat`, token, {
    tableId,
  });

  // Give WS time to receive messages
  await sleep(500);

  ws.close();

  // Basic assertions
  const seen = new Set(events.map((e) => e.event));
  const mustSee = [
    "table.created",
    "table.status_changed",
    "order.created",
    "order.status_changed",
    "order.items_added",
    "queue.registered",
    "queue.status_changed",
    "queue.called",
    "queue.seated",
  ];

  const missing = mustSee.filter((e) => !seen.has(e));
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error("Missing events:", missing);
    process.exitCode = 1;
    return;
  }

  // eslint-disable-next-line no-console
  console.log("Realtime smoke test OK.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

