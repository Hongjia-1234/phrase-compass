"use client";

import { useRef } from "react";
import { Download, ExternalLink, Info, RefreshCw } from "lucide-react";

const TABS = [
  ["regions", "新闻匹配"],
  ["alternatives", "相关表达"],
  ["examples", "真实用例"],
  ["method", "方法说明"]
];

function Pill({ children, tone = "" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function EvidenceScore({ value, label, grade }) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return (
    <div className="evidence-score">
      <div className="score-number"><strong>{safeValue}</strong><span>/100</span></div>
      <div className="score-track" aria-hidden="true"><span style={{ width: `${safeValue}%` }} /></div>
      <div><small>{label}</small><b>{grade}</b></div>
    </div>
  );
}

function ResultsTabs({ active, onChange }) {
  const tabRefs = useRef([]);

  function onKeyDown(event, index) {
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    onChange(TABS[nextIndex][0]);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="result-tabs" role="tablist" aria-label="分析结果栏目">
      {TABS.map(([id, label], index) => (
        <button
          key={id}
          ref={(element) => { tabRefs.current[index] = element; }}
          type="button"
          id={`tab-${id}`}
          role="tab"
          aria-selected={active === id}
          aria-controls={`panel-${id}`}
          tabIndex={active === id ? 0 : -1}
          className={active === id ? "active" : ""}
          onClick={() => onChange(id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RegionsPanel({ data, active }) {
  return (
    <div className="tab-panel region-panel" id="panel-regions" role="tabpanel" aria-labelledby="tab-regions" hidden={!active}>
      {data.sourceStatus !== "ok" && (
        <div className="source-alert"><Info size={17} /><span>{data.sourceStatus === "unavailable" ? "GNews 当前没有返回可用数据。" : "部分参考数据未返回，成功结果仍会保留。"}{data.sourceMessages?.length ? ` 详情：${data.sourceMessages.join("；")}` : ""}</span></div>
      )}
      <div className="region-table-head" aria-hidden="true"><span>新闻来源</span><span>匹配文章</span><span>证据指数</span><span>常见度</span><span>置信度</span></div>
      <div className="region-rows">
        {data.regions.map((region) => {
          const score = Number.isFinite(region.score) ? region.score : 0;
          return (
            <article className="region-row" key={region.id}>
              <div className="region-name"><span className="flag">{region.id}</span><span><strong>{region.name}</strong><small>{region.countries}</small></span></div>
              <dl>
                <div><dt>匹配文章</dt><dd>{region.matches == null ? "—" : `${region.matches.toLocaleString()} 篇`}</dd></div>
                <div className="evidence-cell"><dt>证据指数</dt><dd><span>{region.score == null ? "—" : `${region.score}/100`}</span><span className="regional-bar" aria-hidden="true"><i style={{ width: `${score}%` }} /></span></dd></div>
                <div><dt>近期常见度</dt><dd><Pill tone={region.grade === "高" ? "high" : region.grade === "中" ? "mid" : ""}>{region.grade}</Pill></dd></div>
                <div><dt>置信度</dt><dd>{region.confidence}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
      <div className="reading-note"><Info size={17} /><p><strong>怎样理解这些数字</strong>“匹配文章数”不是短语出现次数，也不是百分比。免费数据约有 12 小时延迟；国家代表发布机构所在地。零结果不代表语法错误。</p></div>
    </div>
  );
}

function AlternativesPanel({ data, active }) {
  return (
    <div className="tab-panel" id="panel-alternatives" role="tabpanel" aria-labelledby="tab-alternatives" hidden={!active}>
      {data.alternatives.length ? (
        <ol className="expression-list">
          {data.alternatives.map((alternative) => (
            <li key={alternative.phrase}>
              <span className="expression-phrase">{alternative.phrase}</span>
              <span>Datamuse 语义相关候选，不保证完全同义</span>
              <strong>{alternative.frequency ? `参考词频 ${alternative.frequency.toFixed(2)}` : "请结合具体语境比较"}</strong>
            </li>
          ))}
        </ol>
      ) : <div className="blank-state">Datamuse 暂未找到可靠的多词相关表达。程序不会为了凑数而编造替代表达。</div>}
    </div>
  );
}

function ExamplesPanel({ data, active }) {
  return (
    <div className="tab-panel" id="panel-examples" role="tabpanel" aria-labelledby="tab-examples" hidden={!active}>
      {data.examples.length ? (
        <div className="article-list">
          {data.examples.map((example, index) => (
            <article key={`${example.url}-${index}`}>
              <div className="article-meta"><Pill>{example.region}</Pill><span>{example.sourceName || example.domain}</span></div>
              <h3>{example.title}</h3>
              <p>{example.excerpt}</p>
              <a href={example.url} target="_blank" rel="noreferrer">查看新闻原文 <ExternalLink size={15} /></a>
            </article>
          ))}
        </div>
      ) : <div className="blank-state">当前查询没有返回可展示的新闻文章。零例句不代表表达一定错误。</div>}
    </div>
  );
}

function MethodPanel({ data, active }) {
  return (
    <div className="tab-panel result-method" id="panel-method" role="tabpanel" aria-labelledby="tab-method" hidden={!active}>
      <div id="result-methodology" className="method-grid">
        <article><h3>匹配与参考区</h3><p>{data.methodology.matching}</p></article>
        <article><h3>评分方法</h3><p>{data.methodology.scoring}</p></article>
        <article><h3>边界与限制</h3><p>{data.methodology.limitations}</p></article>
        <article><h3>请求与缓存</h3><p>{data.methodology.requestPolicy}</p></article>
      </div>
      <footer>方法版本 {data.methodology.version}　查询于 {new Date(data.queriedAt).toLocaleString("zh-CN")}</footer>
    </div>
  );
}

export function ResultsDesk({ data, activeTab, onTabChange, onRefresh, onDownload, loading, quotaUsed, protectiveLimit }) {
  return (
    <section className="results-section" id="results" aria-labelledby="result-title">
      <div className="result-heading">
        <div>
          <span className="result-status">{data.cached ? (data.cacheScope === "browser" ? "本机缓存结果" : "服务缓存结果") : "实时查询结果"}</span>
          <h2 id="result-title">“{data.phrase}”</h2>
          <p>{data.range.start} 至 {data.range.end}<span />{data.methodology.source}<span />本次消耗 {data.quota?.requestCost ?? 0} 次</p>
        </div>
        <div className="result-actions">
          <button className="button button-secondary" type="button" onClick={onRefresh} disabled={loading || quotaUsed >= protectiveLimit} title="跳过缓存，通常消耗 2 次额度"><RefreshCw size={17} />重新查询</button>
          <button className="button button-primary" type="button" onClick={onDownload}><Download size={17} />导出报告</button>
        </div>
      </div>

      <div className="summary-sheet">
        <EvidenceScore value={data.overall.score || 0} label="新闻证据指数" grade={data.overall.grade} />
        <div className="verdict">
          <span>综合判断</span>
          <h3>{data.overall.naturalness}</h3>
          <p>{data.overall.uncertainty}</p>
        </div>
        <dl className="fact-list">
          <div><dt>新闻用例证据</dt><dd>{data.overall.correctness}</dd></div>
          <div><dt>可判断语域</dt><dd>{data.overall.register}</dd></div>
          <div><dt>来源倾向</dt><dd>{data.overall.regionality}</dd></div>
        </dl>
      </div>

      <ResultsTabs active={activeTab} onChange={onTabChange} />
      <RegionsPanel data={data} active={activeTab === "regions"} />
      <AlternativesPanel data={data} active={activeTab === "alternatives"} />
      <ExamplesPanel data={data} active={activeTab === "examples"} />
      <MethodPanel data={data} active={activeTab === "method"} />
    </section>
  );
}
