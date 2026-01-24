import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const queueRegistrationRate = new Rate("queue_registration_success");
const queueStatusUpdateRate = new Rate("queue_status_update_success");
const apiResponseTime = new Trend("api_response_time");

/**
 * Queue API Load Test
 * 
 * Scalable Architecture Targets:
 * - API Response Time: <200ms (P95)
 * - Throughput: Handle peak queue registrations
 * - Error Rate: <0.1%
 */
export const options = {
  stages: [
    { duration: "2m", target: 50 },
    { duration: "5m", target: 200 },
    { duration: "5m", target: 500 },
    { duration: "5m", target: 500 },
    { duration: "2m", target: 200 },
    { duration: "2m", target: 50 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<200", "p(99)<500"],
    http_req_failed: ["rate<0.001"],
    queue_registration_success: ["rate>0.99"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const RESTAURANT_ID = __ENV.RESTAURANT_ID || "test-restaurant-id";

function generateQueueData() {
  return {
    guestName: `Guest ${Math.random().toString(36).substring(7)}`,
    partySize: Math.floor(Math.random() * 8) + 1,
    phoneNumber: `+1${Math.floor(Math.random() * 10000000000)}`,
  };
}

export default function () {
  // Public queue registration
  const queueData = generateQueueData();
  const registerUrl = `${BASE_URL}/api/queue/register/${RESTAURANT_ID}`;
  
  const registerRes = http.post(registerUrl, JSON.stringify(queueData), {
    headers: { "Content-Type": "application/json" },
    tags: { name: "RegisterQueue" },
  });

  const responseTime = registerRes.timings.duration;

  const success = check(registerRes, {
    "queue registration status is 201": (r) => r.status === 201,
    "queue registration response time < 200ms": () => responseTime < 200,
  });

  queueRegistrationRate.add(success);
  apiResponseTime.add(responseTime);

  sleep(1);
}

export function setup() {
  const healthCheck = http.get(`${BASE_URL}/health`);
  if (healthCheck.status !== 200) {
    throw new Error(`API health check failed: ${healthCheck.status}`);
  }
  return { baseUrl: BASE_URL };
}
