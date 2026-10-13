const TEST_KEY = "test-rate-limit-key-1234567890";
let gnewsCalls = 0;
let datamuseCalls = 0;

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname === "api.datamuse.com") {
    datamuseCalls += 1;
    return Response.json([]);
  }
  if (url.hostname !== "gnews.io") {
    throw new Error(`Unexpected network destination: ${url.hostname}`);
  }
  gnewsCalls += 1;
  return Response.json({ errors: ["rate limited"] }, {
    status: 429,
    headers: { "Retry-After": "10" }
  });
};

const { POST } = await import("../app/api/analyze/route.js");
const response = await POST(new Request("http://localhost/api/analyze", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    phrase: "on the weekend",
    days: 7,
    apiKey: TEST_KEY,
    refresh: true
  })
}));
const result = await response.json();

if (response.status !== 200) {
  throw new Error(`Expected a schema-preserving 200 response, received ${response.status}`);
}
if (gnewsCalls !== 1) {
  throw new Error(`Expected HTTP 429 to stop the second queued GNews call; received ${gnewsCalls}`);
}
if (result.quota?.requestCost !== 1) {
  throw new Error("The HTTP 429 response did not report the one request that was actually started");
}
if (datamuseCalls !== 1) {
  throw new Error(`Expected one independent Datamuse call; received ${datamuseCalls}`);
}
if (result.sourceStatus !== "unavailable") {
  throw new Error("Expected unavailable source status after HTTP 429");
}
if (result.regions.some((region) => region.errorCode !== "rate_limited")) {
  throw new Error("Both region results should clearly carry the rate_limited classification");
}
if (!(result.sourceMessages || []).some((message) => message.includes("HTTP 429"))) {
  throw new Error("Expected a clear HTTP 429 message");
}
if (!(result.sourceMessages || []).some((message) => message.includes("剩余的地区请求已停止"))) {
  throw new Error("The HTTP 429 message does not explain the queue circuit breaker");
}
if (result.cached) throw new Error("A failed provider response must not be cached");
if (JSON.stringify(result).includes(TEST_KEY)) throw new Error("The API key leaked into the response");

console.log(JSON.stringify({
  status: "ok",
  gnewsCalls,
  datamuseCalls,
  sourceStatus: result.sourceStatus,
  regionErrorCodes: result.regions.map((region) => region.errorCode),
  sourceMessages: result.sourceMessages
}, null, 2));
