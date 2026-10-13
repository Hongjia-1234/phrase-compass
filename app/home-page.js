"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyBrief, MethodologyPrimer, QueryDesk, SiteFooter, SiteHeader } from "./components/query-desk.js";
import { ResultsDesk } from "./components/results-desk.js";

const KEY_STORAGE = "phrase-compass:gnews-key";
const KEY_SESSION = "phrase-compass:gnews-key-session";
const RESULT_CACHE_PREFIX = "phrase-compass:v2:result:";
const RESULT_CACHE_MS = 24 * 60 * 60 * 1000;
const USAGE_STORAGE = "phrase-compass:gnews-usage:v1";
const DAILY_LIMIT = 100;
const PROTECTIVE_LIMIT = 80;

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function readQuotaUsage() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(USAGE_STORAGE) || "null");
    if (saved?.date !== utcDay()) return 0;
    return Math.max(0, Math.min(DAILY_LIMIT, Number(saved.used) || 0));
  } catch {
    return 0;
  }
}

function writeQuotaUsage(used) {
  try {
    window.localStorage.setItem(
      USAGE_STORAGE,
      JSON.stringify({ date: utcDay(), used: Math.max(0, Math.min(DAILY_LIMIT, used)) })
    );
  } catch {
    // The quota indicator is advisory and must never block analysis by itself.
  }
}

function download(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${data.phrase.replace(/\s+/g, "-")}-analysis.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function cacheName(phrase, days) {
  return `${RESULT_CACHE_PREFIX}${days}:${phrase.trim().toLowerCase()}`;
}

export default function HomePage() {
  const [phrase, setPhrase] = useState("");
  const [days, setDays] = useState("30");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("regions");
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [rememberKey, setRememberKey] = useState(false);
  const [quotaUsed, setQuotaUsed] = useState(0);
  const wordCount = useMemo(() => phrase.trim().split(/\s+/).filter(Boolean).length, [phrase]);

  useEffect(() => {
    const persistent = window.localStorage.getItem(KEY_STORAGE) || "";
    const saved = persistent || window.sessionStorage.getItem(KEY_SESSION) || "";
    setApiKey(saved);
    setKeyDraft(saved);
    setKeySaved(saved.length >= 10);
    setRememberKey(Boolean(persistent));
    const todayUsage = readQuotaUsage();
    setQuotaUsed(todayUsage);
    writeQuotaUsage(todayUsage);
  }, []);

  useEffect(() => {
    if (!data) return;
    const timer = window.setTimeout(() => {
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [data]);

  function recordQuotaUsage(cost) {
    const numericCost = Math.max(0, Number(cost) || 0);
    if (!numericCost) return;
    const next = Math.min(DAILY_LIMIT, readQuotaUsage() + numericCost);
    writeQuotaUsage(next);
    setQuotaUsed(next);
  }

  function saveKey() {
    const clean = keyDraft.trim();
    if (clean.length < 10) {
      setError("请完整复制 GNews 控制台中的 API Key。");
      return;
    }
    window.sessionStorage.setItem(KEY_SESSION, clean);
    if (rememberKey) window.localStorage.setItem(KEY_STORAGE, clean);
    else window.localStorage.removeItem(KEY_STORAGE);
    setApiKey(clean);
    setKeyDraft(clean);
    setKeySaved(true);
    setError("");
  }

  function clearKey() {
    window.localStorage.removeItem(KEY_STORAGE);
    window.sessionStorage.removeItem(KEY_SESSION);
    setApiKey("");
    setKeyDraft("");
    setKeySaved(false);
    setRememberKey(false);
    setShowKey(false);
    setData(null);
    setError("");
  }

  async function analyze(value = phrase, options = {}) {
    const clean = value.trim();
    if (!clean || loading) return;
    if (!apiKey) {
      setError("请先在数据连接设置中填写并保存 GNews API Key。");
      return;
    }
    const count = clean.split(/\s+/).filter(Boolean).length;
    if (count < 2 || count > 8 || clean.length > 160 || /["“”\u0000-\u001f]/.test(clean)) {
      setError("请输入不含引号的连续、精确 2–8 词英语短语（最多 160 个字符）。");
      return;
    }
    setPhrase(clean);
    setLoading(true);
    setError("");
    setData(null);
    setTab("regions");

    try {
      const browserCacheKey = cacheName(clean, days);
      const savedResult = options.refresh ? null : window.localStorage.getItem(browserCacheKey);
      if (savedResult) {
        try {
          const cached = JSON.parse(savedResult);
          if (Date.now() - cached.savedAt < RESULT_CACHE_MS) {
            setData({
              ...cached.value,
              cached: true,
              cacheScope: "browser",
              quota: { ...cached.value.quota, requestCost: 0 }
            });
            return;
          }
          window.localStorage.removeItem(browserCacheKey);
        } catch {
          window.localStorage.removeItem(browserCacheKey);
        }
      }

      const todayUsage = readQuotaUsage();
      if (todayUsage !== quotaUsed) setQuotaUsed(todayUsage);
      if (todayUsage >= PROTECTIVE_LIMIT) {
        setError(
          `为保护每日 100 次额度，程序已在本机估算使用 ${todayUsage} 次后暂停新的联网查询。缓存结果仍可查看；请等到 UTC 次日重置，或以 GNews 后台实际用量为准。`
        );
        return;
      }

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase: clean, days: Number(days), apiKey, refresh: Boolean(options.refresh) })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      recordQuotaUsage(json.quota?.requestCost);
      setData(json);
      if (json.sourceStatus === "ok") {
        window.localStorage.setItem(browserCacheKey, JSON.stringify({ savedAt: Date.now(), value: json }));
      }
    } catch (caught) {
      setError(caught.message || "分析失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  function handleMethodNavigation(event) {
    event.preventDefault();
    if (data) {
      setTab("method");
      window.setTimeout(() => {
        document.getElementById("result-methodology")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 30);
      return;
    }
    document.getElementById("methodology")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main>
      <SiteHeader hasData={Boolean(data)} keySaved={keySaved} onMethodNavigate={handleMethodNavigation} />
      <QueryDesk
        phrase={phrase}
        days={days}
        wordCount={wordCount}
        loading={loading}
        error={error}
        apiKey={apiKey}
        keyDraft={keyDraft}
        keySaved={keySaved}
        rememberKey={rememberKey}
        showKey={showKey}
        quotaUsed={quotaUsed}
        dailyLimit={DAILY_LIMIT}
        protectiveLimit={PROTECTIVE_LIMIT}
        onPhraseChange={setPhrase}
        onDaysChange={setDays}
        onAnalyze={analyze}
        onDraftChange={(value) => {
          setKeyDraft(value);
          setKeySaved(value.trim() === apiKey && apiKey.length >= 10);
        }}
        onRememberChange={(value) => {
          setRememberKey(value);
          if (keySaved) setKeySaved(false);
        }}
        onToggleVisibility={() => setShowKey((value) => !value)}
        onSaveKey={saveKey}
        onClearKey={clearKey}
      />

      {!data && !loading && <EmptyBrief />}
      {data && (
        <ResultsDesk
          data={data}
          activeTab={tab}
          onTabChange={setTab}
          onRefresh={() => analyze(data.phrase, { refresh: true })}
          onDownload={() => download(data)}
          loading={loading}
          quotaUsed={quotaUsed}
          protectiveLimit={PROTECTIVE_LIMIT}
        />
      )}

      <MethodologyPrimer />
      <SiteFooter />
    </main>
  );
}
