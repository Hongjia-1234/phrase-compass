"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  Database,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-react";

export function SiteHeader({ hasData, keySaved, onMethodNavigate }) {
  return (
    <>
      <a className="skip-link" href="#query">跳到查询</a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#query" aria-label="Phrase Compass 首页">
            <span className="brand-mark"><Compass size={19} /></span>
            <span>Phrase Compass</span>
          </a>
          <nav className="primary-nav" aria-label="页面导航">
            <a href="#query">开始查询</a>
            {hasData && <a href="#results">分析结果</a>}
            <a href={hasData ? "#result-methodology" : "#methodology"} onClick={onMethodNavigate}>分析方法</a>
            <a href="#sources">数据来源</a>
          </nav>
          <span className={`connection-badge ${keySaved ? "connected" : ""}`}>
            <i aria-hidden="true" />
            {keySaved ? "GNews 已连接" : "等待连接"}
          </span>
        </div>
      </header>
    </>
  );
}

function ConnectionSettings({
  apiKey,
  keyDraft,
  keySaved,
  rememberKey,
  showKey,
  onDraftChange,
  onRememberChange,
  onToggleVisibility,
  onSave,
  onClear
}) {
  const [open, setOpen] = useState(!keySaved);

  useEffect(() => {
    setOpen(!keySaved);
  }, [keySaved]);

  return (
    <details
      className={`connection-settings ${keySaved ? "ready" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="connection-icon"><KeyRound size={18} /></span>
        <span className="connection-summary-copy">
          <strong>数据连接设置</strong>
          <small>{keySaved ? "GNews API Key 已保存在当前浏览器" : "首次查询前需要填写 GNews API Key"}</small>
        </span>
        <span className={`connection-state ${keySaved ? "ready" : ""}`}>{keySaved ? "已连接" : "待设置"}</span>
        <ChevronDown className="summary-chevron" size={18} aria-hidden="true" />
      </summary>
      <div className="connection-body">
        <p>密钥只发送给本机分析接口，不会写入代码、服务器磁盘或导出报告。</p>
        <div className="key-control-row">
          <label className="key-field">
            <span className="sr-only">GNews API Key</span>
            <input
              type={showKey ? "text" : "password"}
              value={keyDraft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="粘贴你的 GNews API Key"
              autoComplete="off"
              maxLength={200}
            />
            <button type="button" className="reveal-key" onClick={onToggleVisibility} aria-label="显示或隐藏密钥">
              {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </label>
          <button type="button" className="button button-primary save-key" onClick={onSave}>
            <Check size={16} />{keySaved ? "已保存" : "保存密钥"}
          </button>
          {(apiKey || keyDraft) && (
            <button type="button" className="icon-button clear-key" onClick={onClear} aria-label="清除 API Key" title="清除密钥">
              <Trash2 size={17} />
            </button>
          )}
        </div>
        <label className="remember-key">
          <input type="checkbox" checked={rememberKey} onChange={(event) => onRememberChange(event.target.checked)} />
          <span>记住在这台电脑（更改后需再次保存）</span>
        </label>
      </div>
    </details>
  );
}

function QuotaMeter({ used, dailyLimit, protectiveLimit }) {
  const percent = Math.min(100, Math.round((used / dailyLimit) * 100));
  const state = used >= protectiveLimit ? "limit" : used >= 60 ? "warning" : "";

  return (
    <div className={`quota-meter ${state}`}>
      <div className="quota-copy">
        <span><ShieldCheck size={15} /> 今日额度</span>
        <strong>{used}<small> / {dailyLimit}</small></strong>
      </div>
      <div
        className="quota-track"
        role="progressbar"
        aria-label="本机估算的 GNews 今日请求用量"
        aria-valuemin="0"
        aria-valuemax={dailyLimit}
        aria-valuenow={used}
      >
        <span className="quota-fill" style={{ width: `${percent}%` }} />
        <span className="quota-limit-marker" style={{ left: `${(protectiveLimit / dailyLimit) * 100}%` }} aria-hidden="true" />
      </div>
      <p>{used >= protectiveLimit ? "已达到本机保护上限，新联网查询已暂停。" : `保护上限 ${protectiveLimit} 次；新短语通常消耗 2 次。`}</p>
    </div>
  );
}

export function QueryDesk({
  phrase,
  days,
  wordCount,
  loading,
  error,
  apiKey,
  keyDraft,
  keySaved,
  rememberKey,
  showKey,
  quotaUsed,
  dailyLimit,
  protectiveLimit,
  onPhraseChange,
  onDaysChange,
  onAnalyze,
  onDraftChange,
  onRememberChange,
  onToggleVisibility,
  onSaveKey,
  onClearKey
}) {
  const suggestions = ["on the weekend", "at the end of the day", "make a decision"];

  return (
    <section className="query-section" id="query" aria-labelledby="page-title">
      <div className="hero-grid">
        <div className="hero-copy">
          <span className="section-note">近期新闻使用证据</span>
          <h1 id="page-title">先看它如何被写下，<br />再判断它是否常用。</h1>
          <p>查询美国与英国新闻来源中的精确短语，用真实文章说明它近期是否常见、如何使用，以及两地证据有何差异。</p>
        </div>
        <ConnectionSettings
          apiKey={apiKey}
          keyDraft={keyDraft}
          keySaved={keySaved}
          rememberKey={rememberKey}
          showKey={showKey}
          onDraftChange={onDraftChange}
          onRememberChange={onRememberChange}
          onToggleVisibility={onToggleVisibility}
          onSave={onSaveKey}
          onClear={onClearKey}
        />
      </div>

      <div className="query-console">
        <form className="search-form" onSubmit={(event) => { event.preventDefault(); onAnalyze(); }}>
          <Search size={22} aria-hidden="true" />
          <label className="sr-only" htmlFor="phrase-input">英语短语</label>
          <input
            id="phrase-input"
            value={phrase}
            onChange={(event) => onPhraseChange(event.target.value)}
            placeholder="输入连续、精确的 2–8 词英语短语"
            aria-describedby="phrase-count"
          />
          <button className="button button-primary analyze-button" type="submit" disabled={loading || !keySaved}>
            {loading ? "正在查询…" : "开始分析"}
          </button>
          <span id="phrase-count" className={`word-counter ${wordCount > 8 ? "bad" : ""}`} aria-live="polite">{wordCount}/8 词</span>
        </form>

        <div className="query-options">
          <label className="range-control">
            <Clock3 size={16} />
            <span>统计范围</span>
            <select value={days} onChange={(event) => onDaysChange(event.target.value)} disabled={loading}>
              <option value="7">最近 7 天</option>
              <option value="30">最近 30 天</option>
            </select>
          </label>
          <span className="query-rule"><Check size={15} /> 连续精确匹配</span>
          <span className="query-rule"><Globe2 size={15} /> 美国与英国新闻来源</span>
        </div>

        <div className="query-lower-row">
          <div className="suggestions" role="group" aria-label="示例短语">
            <span>可以试试</span>
            {suggestions.map((item) => (
              <button type="button" key={item} disabled={loading || !keySaved} onClick={() => onAnalyze(item)}>{item}</button>
            ))}
          </div>
          <QuotaMeter used={quotaUsed} dailyLimit={dailyLimit} protectiveLimit={protectiveLimit} />
        </div>
      </div>

      {loading && (
        <div className="status-banner loading" role="status" aria-live="polite">
          <Clock3 size={17} />
          <span><strong>正在检索新闻样本</strong>美国与英国查询会依次发送，通常需要约 2–8 秒。</span>
          <i aria-hidden="true" />
        </div>
      )}
      {error && <div className="status-banner error" role="alert"><InfoIcon /><span><strong>无法完成查询</strong>{error}</span></div>}
    </section>
  );
}

function InfoIcon() {
  return <span className="status-icon" aria-hidden="true">!</span>;
}

export function EmptyBrief() {
  return (
    <section className="editorial-brief" aria-labelledby="brief-title">
      <div className="brief-heading">
        <span>查询会告诉你什么</span>
        <h2 id="brief-title">从新闻证据出发，而不是凭感觉打分。</h2>
      </div>
      <div className="brief-columns">
        <article><Globe2 /><h3>比较美英来源</h3><p>分别展示美国和英国新闻来源中的匹配文章数，观察近期书面使用差异。</p></article>
        <article><ShieldCheck /><h3>保留判断边界</h3><p>结果为零不等于表达错误；样本不足时，程序会明确说明无法判断。</p></article>
        <article><BookOpen /><h3>回到真实文章</h3><p>提供来源、标题、原文摘要与链接，让每个判断都能被重新核对。</p></article>
      </div>
    </section>
  );
}

export function MethodologyPrimer() {
  return (
    <section className="methodology-primer" id="methodology" aria-labelledby="methodology-title">
      <div className="section-heading">
        <span>如何阅读结果</span>
        <h2 id="methodology-title">文章匹配是证据，不是绝对词频。</h2>
        <p>Phrase Compass 适合快速判断近期新闻中是否有人这样写。它不是大型平衡语料库，也不会只凭零结果宣布短语错误。</p>
      </div>
      <div className="methodology-columns">
        <article><h3>精确短语</h3><p>系统自动为输入添加引号，并在新闻标题、描述和正文中查找连续词序。</p></article>
        <article><h3>两地样本</h3><p>美国与英国代表新闻发布来源所在国家，是地区倾向的近似观察窗口。</p></article>
        <article><h3>谨慎结论</h3><p>匹配数量会受到收录范围、转载与免费套餐影响，数字应与真实用例一起阅读。</p></article>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer" id="sources">
      <div>
        <span className="footer-brand"><Compass size={17} /> Phrase Compass</span>
        <p>用于个人语言学习参考，不替代语法词典或大型平衡语料库。</p>
      </div>
      <div className="source-list">
        <span><Database size={15} /> GNews API：近期新闻证据</span>
        <span><BookOpen size={15} /> Datamuse：相关表达候选</span>
      </div>
    </footer>
  );
}
