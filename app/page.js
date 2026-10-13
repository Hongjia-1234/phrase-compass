"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Download,
  ExternalLink,
  Info,
  Compass,
  Sparkles,
  Globe2,
  BookOpen,
  ShieldCheck,
  Clock3,
  KeyRound,
  Eye,
  EyeOff,
  Check,
  Trash2,
  RefreshCw
} from "lucide-react";

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
    // The counter is advisory. A blocked localStorage must not break phrase analysis.
  }
}

function Ring({ value = 0, label }) {
  return (
    <div className="ring" style={{ "--score": `${value * 3.6}deg` }}>
      <div><strong>{value}</strong><span>/100</span></div>
      <small>{label}</small>
    </div>
  );
}

function Pill({ children, tone = "" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
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

export default function Home() {
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
      setError("请先在下方填写并保存 GNews API Key。");
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

  return (
    <main>
      <header>
        <a className="brand" href="#"><span><Compass size={20} /></span>PHRASE COMPASS</a>
        <nav><a href="#method">计算方法</a><a href="#sources">数据来源</a><Pill tone="live"><i /> GNews 联网</Pill></nav>
      </header>

      <section className="hero">
        <div className="eyebrow"><Sparkles size={14} /> 近期新闻使用证据</div>
        <h1>这个英语短语，在近期新闻里<br/><em>究竟有多常见？</em></h1>
        <p>查询美国与英国新闻来源中的精确短语，给出大致常见度、真实用例和相关表达。</p>

        <div className={`api-key-panel ${keySaved ? "ready" : ""}`}>
          <KeyRound size={20}/>
          <div className="key-copy">
            <b>{keySaved ? "GNews API Key 已就绪" : "首次使用：填写 GNews API Key"}</b>
            <small>默认只保留到关闭浏览器；不会写进代码、服务器磁盘或导出报告。</small>
            <label className="remember-key">
              <input
                type="checkbox"
                checked={rememberKey}
                onChange={(event) => {
                  setRememberKey(event.target.checked);
                  if (keySaved) setKeySaved(false);
                }}
              />
              记住在这台电脑（需再次保存）
            </label>
          </div>
          <div className="key-input">
            <input
              type={showKey ? "text" : "password"}
              value={keyDraft}
              onChange={(event) => {
                setKeyDraft(event.target.value);
                setKeySaved(event.target.value.trim() === apiKey && apiKey.length >= 10);
              }}
              placeholder="粘贴你的 GNews API Key"
              autoComplete="off"
              maxLength={200}
            />
            <button className="reveal" onClick={() => setShowKey((value) => !value)} aria-label="显示或隐藏密钥">
              {showKey ? <EyeOff size={16}/> : <Eye size={16}/>}
            </button>
          </div>
          <div className="key-actions">
            <button className="save-key" onClick={saveKey}><Check size={15}/>{keySaved ? "已保存" : "保存"}</button>
            {(apiKey || keyDraft) && <button className="clear-key" onClick={clearKey} title="清除密钥"><Trash2 size={15}/></button>}
          </div>
        </div>

        <div className="searchbox">
          <Search size={21} />
          <input
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && analyze()}
            placeholder="输入连续、精确的 2–8 词英语短语"
          />
          <button onClick={() => analyze()} disabled={loading || !keySaved}>{loading ? "正在查询美英样本…" : "开始分析"}</button>
          <div className={`counter ${wordCount > 8 ? "bad" : ""}`}>{wordCount}/8 词</div>
        </div>
        <div className="quick"><span>试试看</span>{["on the weekend", "at the end of the day", "make a decision"].map((item) => <button key={item} disabled={loading || !keySaved} onClick={() => analyze(item)}>{item}</button>)}</div>
        <div className="filters">
          <Clock3 size={15}/><span>统计范围</span>
          <select value={days} onChange={(event) => setDays(event.target.value)} disabled={loading}>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
          </select>
          <span>连续精确匹配 · 美国/英国新闻来源</span>
        </div>
        <div className={`quota-strip ${quotaUsed >= PROTECTIVE_LIMIT ? "limit" : quotaUsed >= 60 ? "warning" : ""}`}>
          <ShieldCheck size={16}/>
          <span>本机估算今日已用 <b>{quotaUsed}/{DAILY_LIMIT}</b></span>
          <span>保护上限 {PROTECTIVE_LIMIT} · 每个新短语通常 2 次 · UTC 每日重置</span>
        </div>
        {loading && <div className="notice"><Clock3 size={16}/><span>正在查询美国与英国新闻样本，通常需要约 2–8 秒，请不要重复点击。</span></div>}
        {error && <div className="error">{error}</div>}
      </section>

      {!data && !loading && <section className="empty-grid">
        <article><Globe2/><h3>美英来源比较</h3><p>分别查看美国和英国新闻来源中的匹配文章数，了解近期书面新闻中的使用情况。</p></article>
        <article><ShieldCheck/><h3>稳定且节省额度</h3><p>每个新短语通常只查询 2 次；成功结果在浏览器保存 24 小时。</p></article>
        <article><BookOpen/><h3>真实文章证据</h3><p>显示匹配数量、媒体来源和原文链接；零结果不代表短语错误。</p></article>
      </section>}

      {data && <section className="results">
        <div className="result-head">
          <div><span className="kicker">分析结果 {data.cached ? `· ${data.cacheScope === "browser" ? "本机缓存" : "服务缓存"}` : "· 实时查询"}</span><h2>“{data.phrase}”</h2><p>{data.range.start} — {data.range.end} · {data.methodology.source} · 本次消耗 {data.quota?.requestCost ?? 0} 次</p></div>
          <div className="result-actions">
            <button className="export" onClick={() => analyze(data.phrase, { refresh: true })} disabled={loading || quotaUsed >= PROTECTIVE_LIMIT} title="将跳过缓存，通常消耗 2 次额度"><RefreshCw size={16}/> 重新联网查询（约 2 次）</button>
            <button className="export" onClick={() => download(data)}><Download size={17}/> 导出完整报告</button>
          </div>
        </div>
        <div className="summary">
          <Ring
            value={data.overall.score || 0}
            label="新闻证据指数"
          />
          <div className="verdict"><span>综合判断</span><h3>{data.overall.naturalness}</h3><p>{data.overall.uncertainty}</p></div>
          <div className="facts">
            <div><small>新闻用例证据</small><b>{data.overall.correctness}</b></div>
            <div><small>可判断语域</small><b>{data.overall.register}</b></div>
            <div><small>来源倾向</small><b>{data.overall.regionality}</b></div>
          </div>
        </div>

        <div className="tabs">
          {[["regions", "新闻匹配"], ["alternatives", "相关表达"], ["examples", "真实用例"], ["method", "方法说明"]].map(([id, label]) => <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{label}</button>)}
        </div>

        {tab === "regions" && <div className="region-list">
          {data.sourceStatus !== "ok" && <div className="source-alert"><Info size={16}/><span>{data.sourceStatus === "unavailable" ? "GNews 当前没有返回可用数据。" : "部分参考数据未返回，成功结果仍会保留。"}{data.sourceMessages?.length ? ` 详情：${data.sourceMessages.join("；")}` : ""}</span></div>}
          <div className="table-head"><span>新闻来源</span><span>匹配文章数</span><span>证据指数</span><span>近期常见度</span><span>置信度</span></div>
          {data.regions.map((region) => <div className="region-row" key={region.id}>
            <strong><span className="flag">{region.id}</span>{region.name}<small>（{region.countries}）</small></strong>
            <span>{region.matches == null ? "—" : region.matches.toLocaleString()}</span>
            <span>{region.score == null ? "—" : `${region.score}/100`}</span>
            <Pill tone={region.grade === "高" ? "high" : region.grade === "中" ? "mid" : ""}>{region.grade}</Pill>
            <span>{region.confidence}</span>
          </div>)}
          <div className="notice"><Info size={16}/><span><b>读数方法：</b>“匹配文章数”不是短语出现次数，也不是百分比。GNews 免费数据约有 12 小时延迟；国家代表发布机构所在地。零结果不代表语法错误。</span></div>
        </div>}

        {tab === "alternatives" && <div className="cards">
          {data.alternatives.length ? data.alternatives.map((alternative, index) => <article key={alternative.phrase}><span>#{index + 1}</span><h3>{alternative.phrase}</h3><p>Datamuse 语义相关候选（不保证完全同义）</p><b>{alternative.frequency ? `Datamuse 参考词频 ${alternative.frequency.toFixed(2)}` : "请结合具体语境比较"}</b></article>) : <div className="blank">Datamuse 暂未找到可靠的多词相关表达。程序不会为了凑数而编造替代表达。</div>}
        </div>}

        {tab === "examples" && <div className="examples">
          {data.examples.length ? data.examples.map((example, index) => <article key={`${example.url}-${index}`}><div><Pill>{example.region}</Pill><span>{example.sourceName || example.domain}</span></div><h3>{example.title}</h3><p>{example.excerpt}</p><a href={example.url} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={14}/></a></article>) : <div className="blank">当前查询没有返回可展示的新闻文章。零例句不代表表达一定错误。</div>}
        </div>}

        {tab === "method" && <div className="method" id="method">
          <article><span>01</span><h3>匹配与参考区</h3><p>{data.methodology.matching}</p></article>
          <article><span>02</span><h3>评分方法</h3><p>{data.methodology.scoring}</p></article>
          <article><span>03</span><h3>边界与限制</h3><p>{data.methodology.limitations}</p></article>
          <article><span>04</span><h3>请求与缓存</h3><p>{data.methodology.requestPolicy}</p></article>
          <footer>方法版本 {data.methodology.version} · 查询于 {new Date(data.queriedAt).toLocaleString("zh-CN")}</footer>
        </div>}
      </section>}

      <footer className="site-footer" id="sources"><span>Phrase Compass</span><p>GNews 新闻证据版 · 用于个人语言学习参考，不替代语法词典或大型平衡语料库。</p></footer>
    </main>
  );
}
