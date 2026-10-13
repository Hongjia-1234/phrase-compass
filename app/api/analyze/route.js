import { createHash } from "node:crypto";
import { NextResponse } from "next/server.js";

const REFERENCES = [
  {
    id: "US",
    name: "美国新闻来源",
    countries: "GNews 美国来源筛选",
    country: "us"
  },
  {
    id: "GB",
    name: "英国新闻来源",
    countries: "GNews 英国来源筛选",
    country: "gb"
  }
];

const ALLOWED_DAYS = new Set([7, 30]);
const DAY_MS = 24 * 60 * 60 * 1000;
const GNEWS_DATA_DELAY_MS = 12 * 60 * 60 * 1000;
const GNEWS_INTERVAL_MS = 1200;
const GNEWS_TIMEOUT_MS = 12_000;
const DATAMUSE_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

const resultCache = new Map();
const inFlightRequests = new Map();
let gnewsQueue = Promise.resolve();
let lastGNewsStart = 0;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class InputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InputError";
    this.code = code;
  }
}

function sourceError(code, message, status = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.safeForClient = true;
  return error;
}

function cleanPhrase(value) {
  if (typeof value !== "string") {
    throw new InputError("invalid_phrase", "请输入 2–8 个英文词组成的短语。");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new InputError("invalid_phrase", "请输入 2–8 个英文词组成的短语。");
  }
  if (trimmed.length > 160) {
    throw new InputError("phrase_too_long", "短语不能超过 160 个字符。");
  }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(trimmed)) {
    throw new InputError("invalid_phrase", "短语不能包含换行、制表符或其他控制字符。");
  }
  if (/["“”„‟＂]/u.test(trimmed)) {
    throw new InputError("invalid_phrase", "短语中不要输入双引号；系统会自动进行精确短语查询。");
  }

  const phrase = trimmed.replace(/\s+/gu, " ");
  const words = phrase.split(" ").filter(Boolean);
  const englishWord = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/u;
  if (words.length < 2 || words.length > 8 || words.some((word) => !englishWord.test(word))) {
    throw new InputError(
      "invalid_phrase",
      "请输入连续、精确的 2–8 词英文短语；可使用词内连字符或撇号。"
    );
  }
  return phrase;
}

function cleanApiKey(value) {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (apiKey.length < 10) {
    throw new InputError("missing_api_key", "请先填写并保存有效的 GNews API Key。");
  }
  if (apiKey.length > 512 || /\s|[\u0000-\u001f\u007f-\u009f]/u.test(apiKey)) {
    throw new InputError("invalid_api_key", "GNews API Key 格式无效，请重新复制后再试。");
  }
  return apiKey;
}

function credentialFingerprint(apiKey) {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildWindow(days) {
  const now = Date.now();
  return {
    startDate: new Date(now - days * DAY_MS),
    endDate: new Date(now - GNEWS_DATA_DELAY_MS)
  };
}

function makeCacheKey(phrase, days) {
  return `gnews-v2|${days}|${phrase.toLowerCase()}`;
}

function readCache(cacheKey, fingerprint, refresh) {
  if (refresh) return null;
  const cached = resultCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.savedAt >= CACHE_TTL_MS) {
    resultCache.delete(cacheKey);
    return null;
  }
  // The cache key deliberately contains no API key. A one-way fingerprint in the
  // entry prevents a newly supplied credential from being "validated" by old data.
  return cached.credentialFingerprint === fingerprint ? cached.value : null;
}

function writeCache(cacheKey, fingerprint, value) {
  resultCache.set(cacheKey, {
    savedAt: Date.now(),
    credentialFingerprint: fingerprint,
    value
  });
  while (resultCache.size > MAX_CACHE_ENTRIES) {
    resultCache.delete(resultCache.keys().next().value);
  }
}

function enqueueGNews(circuit, task) {
  const run = gnewsQueue.then(async () => {
    if (circuit.error) throw circuit.error;
    const wait = Math.max(0, GNEWS_INTERVAL_MS - (Date.now() - lastGNewsStart));
    if (wait > 0) await delay(wait);
    if (circuit.error) throw circuit.error;
    lastGNewsStart = Date.now();
    return task();
  });
  gnewsQueue = run.catch(() => undefined);
  return run;
}

function stopQueuedSiblings(circuit, error) {
  if (!circuit.error) circuit.error = error;
  return error;
}

function classifyGNewsResponse(response, circuit) {
  if (response.status === 400) {
    return stopQueuedSiblings(
      circuit,
      sourceError(
        "bad_request",
        "GNews 拒绝了查询参数（HTTP 400）。请检查短语或日期范围后重试。",
        400
      )
    );
  }
  if (response.status === 401) {
    return stopQueuedSiblings(
      circuit,
      sourceError(
        "invalid_key",
        "GNews API Key 无效或已被撤销（HTTP 401）。请重新复制密钥。",
        401
      )
    );
  }
  if (response.status === 403) {
    return stopQueuedSiblings(
      circuit,
      sourceError(
        "access_denied",
        "GNews 拒绝访问（HTTP 403），通常表示套餐、额度或权限限制。",
        403
      )
    );
  }
  if (response.status === 429) {
    return stopQueuedSiblings(
      circuit,
      sourceError(
        "rate_limited",
        "GNews 当前请求过多（HTTP 429）。本次剩余的地区请求已停止，请稍后再试。",
        429
      )
    );
  }
  if (response.status >= 500 && response.status <= 599) {
    return sourceError(
      "provider_unavailable",
      `GNews 服务暂时异常（HTTP ${response.status}），请稍后再试。`,
      response.status
    );
  }
  if (!response.ok) {
    return sourceError(
      "provider_error",
      `GNews 返回未预期状态（HTTP ${response.status}）。`,
      response.status
    );
  }
  return null;
}

function excerpt(article = {}) {
  return String(article.description || article.content || article.title || "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 280);
}

function hostname(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

async function fetchGNews(apiKey, phrase, reference, startDate, endDate, circuit) {
  return enqueueGNews(circuit, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GNEWS_TIMEOUT_MS);
    try {
      const params = new URLSearchParams({
        q: `"${phrase}"`,
        lang: "en",
        country: reference.country,
        in: "title,description,content",
        max: "10",
        from: startDate.toISOString(),
        to: endDate.toISOString(),
        sortby: "relevance",
        apikey: apiKey
      });
      circuit.requestsStarted += 1;
      const response = await fetch(`https://gnews.io/api/v4/search?${params.toString()}`, {
        signal: controller.signal,
        cache: "no-store"
      });
      const responseError = classifyGNewsResponse(response, circuit);
      if (responseError) throw responseError;

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw sourceError("invalid_response", "GNews 返回了无法解析的数据。", response.status);
      }

      const matchingArticles = Number(payload?.totalArticles);
      if (!Number.isFinite(matchingArticles) || matchingArticles < 0) {
        throw sourceError("invalid_response", "GNews 没有返回有效的匹配文章数。", response.status);
      }

      return {
        id: reference.id,
        name: reference.name,
        countries: reference.countries,
        matches: Math.trunc(matchingArticles),
        matchingArticles: Math.trunc(matchingArticles),
        articles: (Array.isArray(payload.articles) ? payload.articles : [])
          .slice(0, 5)
          .map((article) => ({
            title: String(article?.title || "无标题"),
            url: String(article?.url || ""),
            domain:
              hostname(article?.source?.url || article?.url) ||
              String(article?.source?.name || "未知来源"),
            sourceName: String(article?.source?.name || "未知来源"),
            date: String(article?.publishedAt || ""),
            region: reference.name,
            excerpt: excerpt(article)
          }))
          .filter((article) => article.url),
        warnings: []
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw sourceError(
          "timeout",
          `GNews ${reference.name}查询超时（超过 ${GNEWS_TIMEOUT_MS / 1000} 秒），请检查网络后重试。`
        );
      }
      if (error?.safeForClient) throw error;
      throw sourceError(
        "network_error",
        `无法连接 GNews 完成${reference.name}查询，请检查网络、VPN 或代理设置。`
      );
    } finally {
      clearTimeout(timer);
    }
  });
}

function datamuseFrequency(item) {
  const tag = Array.isArray(item?.tags)
    ? item.tags.find((candidate) => String(candidate).startsWith("f:"))
    : null;
  const value = Number(String(tag || "").slice(2));
  return Number.isFinite(value) ? value : 0;
}

function isCandidateExpression(value, originalPhrase) {
  const phrase = String(value || "").trim().replace(/\s+/gu, " ");
  if (!phrase || phrase.toLowerCase() === originalPhrase.toLowerCase()) return false;
  const words = phrase.split(" ");
  const englishWord = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/u;
  return words.length >= 2 && words.length <= 8 && words.every((word) => englishWord.test(word));
}

async function alternatives(phrase) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATAMUSE_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ ml: phrase, md: "f", max: "50" });
    const response = await fetch(`https://api.datamuse.com/words?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload)) return [];

    const seen = new Set();
    return payload
      .filter((item) => isCandidateExpression(item?.word, phrase))
      .map((item) => ({
        phrase: String(item.word).trim().replace(/\s+/gu, " "),
        frequency: datamuseFrequency(item)
      }))
      .filter((item) => {
        const key = item.phrase.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => right.frequency - left.frequency || left.phrase.localeCompare(right.phrase))
      .slice(0, 5);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function evidenceBand(matchingArticles) {
  if (matchingArticles <= 2) return "样本不足";
  if (matchingArticles <= 9) return "有限证据";
  return "有一定证据";
}

function evidenceGrade(matchingArticles) {
  if (matchingArticles >= 50) return "高";
  if (matchingArticles >= 10) return "中";
  return "低";
}

function evidenceConfidence(matchingArticles) {
  if (matchingArticles >= 30) return "高";
  if (matchingArticles >= 10) return "中";
  return "低";
}

function evidenceScore(matchingArticles) {
  if (matchingArticles <= 0) return 0;
  if (matchingArticles <= 2) return Math.round(10 + matchingArticles * 5);
  if (matchingArticles <= 9) return 25 + Math.round(((matchingArticles - 3) / 6) * 20);
  if (matchingArticles <= 49) return 50 + Math.round(((matchingArticles - 10) / 39) * 24);
  return Math.min(100, 75 + Math.round(12.5 * Math.log10(matchingArticles / 50)));
}

function regionality(regions) {
  if (regions.length !== 2 || regions.some((region) => region.matches == null)) {
    return "数据不完整，无法判断";
  }
  const [american, british] = regions;
  const total = american.matches + british.matches;
  if (total < 10) return "样本不足，暂不判断";

  const high = Math.max(american.matches, british.matches);
  const low = Math.min(american.matches, british.matches);
  const reachesThreeToOne = low === 0 ? high > 0 : high / low >= 3;
  if (!reachesThreeToOne) return "地区倾向不明显";
  return american.matches > british.matches
    ? "匹配新闻中相对偏美式"
    : "匹配新闻中相对偏英式";
}

function overallCorrectness(matchingArticles, sourceStatus) {
  if (sourceStatus === "unavailable") return "新闻数据暂不可用，无法据此确认表达。";
  const prefix = sourceStatus === "partial" ? "仅按成功返回的地区计算：" : "";
  if (matchingArticles <= 2) return `${prefix}新闻样本不足，不能据此确认表达是否自然。`;
  if (matchingArticles <= 9) return `${prefix}找到少量匹配新闻，只能作为有限参考。`;
  return `${prefix}找到一定数量的匹配新闻，可作为真实使用证据。`;
}

function overallNaturalness(matchingArticles, sourceStatus) {
  if (sourceStatus === "unavailable") return "新闻数据暂不可用，无法判断";
  if (matchingArticles <= 2) return "新闻证据不足，无法判断";
  if (matchingArticles <= 9) return "存在有限的新闻使用证据";
  return "新闻样本中有一定的使用证据";
}

async function analyzeFresh(apiKey, phrase, days) {
  const { startDate, endDate } = buildWindow(days);
  const circuit = { error: null, requestsStarted: 0 };

  const [referenceResults, relatedExpressions] = await Promise.all([
    Promise.allSettled(
      REFERENCES.map((reference) =>
        fetchGNews(apiKey, phrase, reference, startDate, endDate, circuit)
      )
    ),
    alternatives(phrase)
  ]);

  const rawRegions = referenceResults.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      id: REFERENCES[index].id,
      name: REFERENCES[index].name,
      countries: REFERENCES[index].countries,
      matches: null,
      matchingArticles: null,
      articles: [],
      warnings: [result.reason?.message || "GNews 查询失败。"],
      errorCode: result.reason?.code || "unknown"
    };
  });

  const available = rawRegions.filter((region) => region.matches != null);
  const totalMatchingArticles = available.reduce((sum, region) => sum + region.matches, 0);
  const regions = rawRegions.map((region) => ({
    ...region,
    score: region.matches == null ? null : evidenceScore(region.matches),
    grade: region.matches == null ? "暂无数据" : evidenceGrade(region.matches),
    confidence: region.matches == null ? "无" : evidenceConfidence(region.matches),
    evidence: region.matches == null ? "暂无数据" : evidenceBand(region.matches),
    sharePercent:
      region.matches == null || totalMatchingArticles === 0
        ? null
        : Math.round((region.matches / totalMatchingArticles) * 100)
  }));

  const sourceStatus =
    available.length === REFERENCES.length ? "ok" : available.length ? "partial" : "unavailable";
  const meanMatchingArticles = available.length
    ? totalMatchingArticles / available.length
    : null;
  const partialWarning = sourceStatus === "partial" ? "当前只有部分地区数据可用；" : "";

  return {
    phrase,
    queriedAt: new Date().toISOString(),
    range: {
      start: formatDate(startDate),
      end: formatDate(endDate),
      startAt: startDate.toISOString(),
      endAt: endDate.toISOString(),
      days
    },
    overall: {
      score: meanMatchingArticles == null ? null : evidenceScore(meanMatchingArticles),
      grade: meanMatchingArticles == null ? "暂无数据" : evidenceGrade(meanMatchingArticles),
      evidence: sourceStatus === "unavailable" ? "暂无数据" : evidenceBand(totalMatchingArticles),
      matchingArticles: sourceStatus === "unavailable" ? null : totalMatchingArticles,
      correctness: overallCorrectness(totalMatchingArticles, sourceStatus),
      naturalness: overallNaturalness(totalMatchingArticles, sourceStatus),
      register: "新闻及一般书面语证据",
      regionality: regionality(regions),
      uncertainty:
        `${partialWarning}这里统计的是 GNews 收录且匹配短语的新闻文章数，不是短语在全文中的出现次数，也不代表全部口语或整个互联网。`
    },
    regions,
    sourceStatus,
    sourceMessages: [...new Set(regions.flatMap((region) => region.warnings || []))],
    quota: {
      requestCost: circuit.requestsStarted,
      dailyLimit: 100,
      protectiveLimit: 80,
      resetTimezone: "UTC"
    },
    alternatives: relatedExpressions,
    examples: regions.flatMap((region) => region.articles).slice(0, 8),
    methodology: {
      version: "2.2",
      source: "GNews API + Datamuse 1.1",
      matching:
        "分别向 GNews 查询美国和英国新闻来源各一次；短语由系统加双引号，并在标题、描述和正文中按连续词序匹配，结果按相关度排序。",
      scoring:
        "所有数字均指匹配新闻文章数。0–2 篇为样本不足，3–9 篇为有限证据，10 篇以上才视为有一定证据；高/中/低等级采用更保守的 50/10 篇阈值。",
      limitations:
        "GNews 的 totalArticles 是匹配文章数，不是词频或短语出现总次数。新闻来源覆盖、转载和套餐可见范围都可能影响结果，零结果不能证明表达错误。",
      requestPolicy:
        "两个 GNews 请求进入全局队列，启动间隔至少 1.2 秒；HTTP 429 会停止同次分析尚未发出的地区请求。成功结果缓存 24 小时，相同在途分析会合并；页面在本机估算每日用量，并在 80/100 时停止新的联网查询。"
    }
  };
}

function getInFlight(cacheKey, fingerprint) {
  return inFlightRequests.get(cacheKey)?.get(fingerprint) || null;
}

function setInFlight(cacheKey, fingerprint, promise) {
  let bucket = inFlightRequests.get(cacheKey);
  if (!bucket) {
    bucket = new Map();
    inFlightRequests.set(cacheKey, bucket);
  }
  bucket.set(fingerprint, promise);
}

function clearInFlight(cacheKey, fingerprint, promise) {
  const bucket = inFlightRequests.get(cacheKey);
  if (!bucket || bucket.get(fingerprint) !== promise) return;
  bucket.delete(fingerprint);
  if (bucket.size === 0) inFlightRequests.delete(cacheKey);
}

function jsonError(error, status, code) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("请求内容不是有效的 JSON。", 400, "invalid_json");
  }

  try {
    const phrase = cleanPhrase(body?.phrase);
    const apiKey = cleanApiKey(body?.apiKey);
    const days = ALLOWED_DAYS.has(Number(body?.days)) ? Number(body.days) : 30;
    const refresh = body?.refresh === true;
    const fingerprint = credentialFingerprint(apiKey);
    const cacheKey = makeCacheKey(phrase, days);
    const cached = readCache(cacheKey, fingerprint, refresh);
    if (cached) {
      return NextResponse.json({
        ...cached,
        cached: true,
        quota: { ...cached.quota, requestCost: 0 }
      });
    }

    let work = getInFlight(cacheKey, fingerprint);
    if (!work) {
      work = analyzeFresh(apiKey, phrase, days).then((payload) => {
        if (payload.sourceStatus === "ok") writeCache(cacheKey, fingerprint, payload);
        return payload;
      });
      setInFlight(cacheKey, fingerprint, work);
    }

    try {
      const payload = await work;
      return NextResponse.json({ ...payload, cached: false });
    } finally {
      clearInFlight(cacheKey, fingerprint, work);
    }
  } catch (error) {
    if (error instanceof InputError) {
      return jsonError(error.message, 400, error.code);
    }
    // Do not return arbitrary exception text: a provider/runtime error could echo a request URL.
    return jsonError("分析暂时失败，请稍后重试。", 500, "analysis_failed");
  }
}
