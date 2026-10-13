const GOOD_KEY = "test-good-key-1234567890";
const DIFFERENT_BAD_KEY = "test-different-key-0987654321";
const gnewsCalls = [];
const datamuseCalls = [];

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname === "api.datamuse.com") {
    datamuseCalls.push({
      phrase: url.searchParams.get("ml"),
      at: Date.now()
    });
    if (url.searchParams.get("ml") === "make a decision") {
      throw new TypeError("mock Datamuse outage");
    }
    return Response.json([
      { word: "during the weekend", tags: ["f:2"] },
      { word: "over the weekend", tags: ["f:12.5"] },
      { word: "at weekends", tags: ["f:9.8"] },
      { word: "weekend", tags: ["f:500"] }
    ]);
  }
  if (url.hostname !== "gnews.io") {
    throw new Error(`Unexpected network destination: ${url.hostname}`);
  }

  gnewsCalls.push({ url, at: Date.now() });
  if (url.searchParams.get("apikey") === DIFFERENT_BAD_KEY) {
    return Response.json({ errors: ["invalid key"] }, { status: 401 });
  }

  const country = url.searchParams.get("country");
  const totalArticles = country === "us" ? 12 : 5;
  return Response.json({
    totalArticles,
    articles: [
      {
        title: `${country.toUpperCase()} example`,
        description: `A real example for the ${country.toUpperCase()} result.`,
        content: "Mock full article content.",
        url: `https://${country}.example.test/story`,
        publishedAt: "2026-08-20T12:00:00Z",
        source: {
          name: `${country.toUpperCase()} News`,
          url: `https://${country}.example.test`
        }
      }
    ]
  });
};

const { POST } = await import("../app/api/analyze/route.js");

function request(body) {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function post(body) {
  const response = await POST(request(body));
  return { response, result: await response.json() };
}

const firstStartedAt = Date.now();
const first = await post({ phrase: "on the weekend", days: 7, apiKey: GOOD_KEY });
const firstFinishedAt = Date.now();

if (first.response.status !== 200) {
  throw new Error(`Expected a successful response, received ${first.response.status}`);
}
if (gnewsCalls.length !== 2) {
  throw new Error(`Expected exactly two GNews calls, received ${gnewsCalls.length}`);
}
if (first.result.quota?.requestCost !== 2) {
  throw new Error(`Expected the fresh result to report a cost of 2, received ${first.result.quota?.requestCost}`);
}

const firstGap = gnewsCalls[1].at - gnewsCalls[0].at;
if (firstGap < 1100) {
  throw new Error(`Expected at least 1100ms between GNews calls, measured ${firstGap}ms`);
}

for (const call of gnewsCalls.slice(0, 2)) {
  const params = call.url.searchParams;
  if (params.get("q") !== '"on the weekend"') throw new Error("Exact quoted query is missing");
  if (params.get("in") !== "title,description,content") throw new Error("Search fields are wrong");
  if (params.get("sortby") !== "relevance") throw new Error("GNews sort order is wrong");
  if (params.get("lang") !== "en") throw new Error("English language filter is missing");
}

const firstCountries = gnewsCalls.slice(0, 2).map((call) => call.url.searchParams.get("country"));
if (firstCountries.join(",") !== "us,gb") {
  throw new Error(`Expected one US and one GB query, received ${firstCountries.join(",")}`);
}

const firstFrom = gnewsCalls[0].url.searchParams.get("from");
const firstTo = gnewsCalls[0].url.searchParams.get("to");
if (gnewsCalls[1].url.searchParams.get("from") !== firstFrom) {
  throw new Error("US and GB requests do not share the same start instant");
}
if (gnewsCalls[1].url.searchParams.get("to") !== firstTo) {
  throw new Error("US and GB requests do not share the same end instant");
}

const fromTime = Date.parse(firstFrom);
const toTime = Date.parse(firstTo);
const minimumExpectedStart = firstStartedAt - 7 * 24 * 60 * 60 * 1000 - 2000;
const maximumExpectedStart = firstFinishedAt - 7 * 24 * 60 * 60 * 1000 + 2000;
const minimumExpectedEnd = firstStartedAt - 12 * 60 * 60 * 1000 - 2000;
const maximumExpectedEnd = firstFinishedAt - 12 * 60 * 60 * 1000 + 2000;
if (fromTime < minimumExpectedStart || fromTime > maximumExpectedStart) {
  throw new Error("GNews start instant is not now minus the requested number of days");
}
if (toTime < minimumExpectedEnd || toTime > maximumExpectedEnd) {
  throw new Error("GNews end instant is not now minus 12 hours");
}

if (first.result.regions.map((region) => region.matches).join(",") !== "12,5") {
  throw new Error("Matching article counts were not mapped to the two regions");
}
if (first.result.overall.matchingArticles !== 17) {
  throw new Error("Overall matching article count is incorrect");
}
if (!Number.isInteger(first.result.overall.score)) {
  throw new Error("Overall evidence score must remain an integer when the regional mean is fractional");
}
if (!first.result.overall.correctness.includes("匹配新闻")) {
  throw new Error("Overall verdict is not framed as news evidence");
}
if (first.result.alternatives.map((item) => item.frequency).join(",") !== "12.5,9.8,2") {
  throw new Error("Datamuse candidates are not sorted by frequency");
}
if (JSON.stringify(first.result).includes(GOOD_KEY)) {
  throw new Error("The API key leaked into the response");
}

const callsBeforeCache = gnewsCalls.length;
const datamuseBeforeCache = datamuseCalls.length;
const cached = await post({ phrase: "on the weekend", days: 7, apiKey: GOOD_KEY });
if (!cached.result.cached) throw new Error("Expected the second identical request to use the cache");
if (cached.result.quota?.requestCost !== 0) {
  throw new Error("A cached result did not report zero request cost");
}
if (gnewsCalls.length !== callsBeforeCache || datamuseCalls.length !== datamuseBeforeCache) {
  throw new Error("A cache hit unexpectedly called an external provider");
}

const callsBeforeMissingKey = gnewsCalls.length;
const missingKey = await post({ phrase: "on the weekend", days: 7 });
if (missingKey.response.status !== 400 || missingKey.result.code !== "missing_api_key") {
  throw new Error("A missing API key did not produce a clear 400 error");
}
if (gnewsCalls.length !== callsBeforeMissingKey) {
  throw new Error("Missing-key validation happened after provider/cache processing");
}

const callsBeforeChangedKey = gnewsCalls.length;
const changedKey = await post({
  phrase: "on the weekend",
  days: 7,
  apiKey: DIFFERENT_BAD_KEY
});
if (changedKey.result.cached || changedKey.result.sourceStatus !== "unavailable") {
  throw new Error("A changed invalid key was incorrectly hidden by the old successful cache entry");
}
if (gnewsCalls.length !== callsBeforeChangedKey + 1) {
  throw new Error("Expected one credential-validation provider call before the 401 circuit stopped its sibling");
}
if (changedKey.result.quota?.requestCost !== 1) {
  throw new Error("The stopped credential-validation request did not report its actual cost");
}
if (!changedKey.result.sourceMessages.some((message) => message.includes("HTTP 401"))) {
  throw new Error("HTTP 401 was not clearly classified");
}
if (JSON.stringify(changedKey.result).includes(DIFFERENT_BAD_KEY)) {
  throw new Error("The changed API key leaked into an error response");
}

const beforeMergedCalls = gnewsCalls.length;
const [mergedOne, mergedTwo] = await Promise.all([
  post({ phrase: "make a decision", days: 30, apiKey: GOOD_KEY }),
  post({ phrase: "make a decision", days: 30, apiKey: GOOD_KEY })
]);
if (mergedOne.response.status !== 200 || mergedTwo.response.status !== 200) {
  throw new Error("Merged in-flight requests did not both complete successfully");
}
if (gnewsCalls.length !== beforeMergedCalls + 2) {
  throw new Error("Identical in-flight requests were not merged");
}
if (mergedOne.result.alternatives.length || mergedTwo.result.alternatives.length) {
  throw new Error("Datamuse failure should yield no candidates without failing GNews analysis");
}

const quoteRejected = await post({
  phrase: 'on "the" weekend',
  days: 7,
  apiKey: GOOD_KEY
});
if (quoteRejected.response.status !== 400 || quoteRejected.result.code !== "invalid_phrase") {
  throw new Error("Double quotes in user input were not rejected");
}

const allGaps = gnewsCalls.slice(1).map((call, index) => call.at - gnewsCalls[index].at);
if (allGaps.some((gap) => gap < 1100)) {
  throw new Error(`Global GNews queue gap was too short: ${Math.min(...allGaps)}ms`);
}

console.log(JSON.stringify({
  status: "ok",
  gnewsCalls: gnewsCalls.length,
  datamuseCalls: datamuseCalls.length,
  minimumGNewsGapMs: Math.min(...allGaps),
  cacheVerified: true,
  inFlightMergeVerified: true,
  changedKeyBypassVerified: true,
  missingKeyVerified: true,
  regions: first.result.regions.map(({ id, matches, evidence, grade }) => ({
    id,
    matchingArticles: matches,
    evidence,
    grade
  }))
}, null, 2));
