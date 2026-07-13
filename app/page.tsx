"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type GeneratedLink = {
  url: string;
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
  label?: string;
  createdAt: string;
  invalidatedAt?: string;
  previousExpiresAt?: string;
  wasExpired?: boolean;
  source?: "created" | "extended";
};

type LinkResponse = {
  url?: string;
  token?: string;
  label?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
  previousExpiresAt?: string;
  wasExpired?: boolean;
  error?: string;
};

type InvalidateResponse = {
  token?: string;
  tokenHash?: string;
  label?: string;
  expiresAt?: string;
  invalidatedAt?: string;
  alreadyExpired?: boolean;
  alreadyInvalidated?: boolean;
  error?: string;
};

type LinkStatusResponse = {
  url?: string;
  token?: string;
  label?: string;
  issuedAt?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
  expired?: boolean;
  invalidated?: boolean;
  valid?: boolean;
  status?: "active" | "expired" | "invalidated";
  error?: string;
};

type ExpiryUnit = "minutes" | "hours" | "days";
type ExpiryMode = "duration" | "exact";
type WorkMode = "create" | "query" | "extend" | "invalidate";
type MessageKind = "success" | "error";
type HistoryExportFormat = "csv" | "json" | "txt";

type HistoryExportRecord = {
  label?: string;
  url: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  expiresInSeconds: number;
  invalidatedAt?: string;
  previousExpiresAt?: string;
  wasExpired?: boolean;
  source?: "created" | "extended";
};

const storageKey = "yaml-link-history";
const passwordStorageKey = "yaml-link-admin-password";
const historyPageSize = 20;

export default function Home() {
  const [workMode, setWorkMode] = useState<WorkMode>("create");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [passwordCacheLoaded, setPasswordCacheLoaded] = useState(false);
  const [label, setLabel] = useState("");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("duration");
  const [durationValue, setDurationValue] = useState("24");
  const [durationUnit, setDurationUnit] = useState<ExpiryUnit>("hours");
  const [exactTime, setExactTime] = useState("");

  const [queryLinkInput, setQueryLinkInput] = useState("");
  const [queryResult, setQueryResult] = useState<LinkStatusResponse | null>(null);
  const [extendLinkInput, setExtendLinkInput] = useState("");
  const [extendLabel, setExtendLabel] = useState("");
  const [extendMode, setExtendMode] = useState<ExpiryMode>("duration");
  const [extendDurationValue, setExtendDurationValue] = useState("7");
  const [extendDurationUnit, setExtendDurationUnit] = useState<ExpiryUnit>("days");
  const [extendExactTime, setExtendExactTime] = useState("");
  const [invalidateLinkInput, setInvalidateLinkInput] = useState("");

  const [links, setLinks] = useState<GeneratedLink[]>([]);
  const [historyCacheLoaded, setHistoryCacheLoaded] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyExportFormat, setHistoryExportFormat] = useState<HistoryExportFormat>("csv");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [queryError, setQueryError] = useState("");
  const [queryStatus, setQueryStatus] = useState("");
  const [extendError, setExtendError] = useState("");
  const [extendStatus, setExtendStatus] = useState("");
  const [invalidateError, setInvalidateError] = useState("");
  const [invalidateStatus, setInvalidateStatus] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyStatusKind, setHistoryStatusKind] = useState<MessageKind>("success");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isExtending, setIsExtending] = useState(false);
  const [isInvalidating, setIsInvalidating] = useState(false);
  const [invalidatingToken, setInvalidatingToken] = useState("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);

      if (saved) {
        const parsed: unknown = JSON.parse(saved);

        if (!Array.isArray(parsed)) {
          throw new Error("历史缓存格式无效");
        }

        setLinks(mergeGeneratedLinks([], parsed.filter(isGeneratedLink)));
      }
    } catch {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // The persistence effect below reports unavailable browser storage.
      }
    } finally {
      setHistoryCacheLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!historyCacheLoaded) {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(links));
    } catch {
      setHistoryStatusKind("error");
      setHistoryStatus("历史缓存写入失败，请检查浏览器存储空间");
    }
  }, [historyCacheLoaded, links]);

  useEffect(() => {
    function syncHistoryAcrossTabs(event: StorageEvent) {
      if (event.key !== storageKey || event.storageArea !== window.localStorage) {
        return;
      }

      try {
        const parsed: unknown = event.newValue ? JSON.parse(event.newValue) : [];

        if (!Array.isArray(parsed)) {
          return;
        }

        if (parsed.length === 0) {
          setLinks([]);
          setHistorySearch("");
          setHistoryPage(1);
          return;
        }

        const storedLinks = parsed.filter(isGeneratedLink);

        if (storedLinks.length > 0) {
          setLinks((current) => mergeGeneratedLinks(current, storedLinks));
        }
      } catch {
        // Ignore malformed writes from another tab and preserve the current history.
      }
    }

    window.addEventListener("storage", syncHistoryAcrossTabs);
    return () => window.removeEventListener("storage", syncHistoryAcrossTabs);
  }, []);

  useEffect(() => {
    const savedPassword = window.localStorage.getItem(passwordStorageKey);

    if (savedPassword) {
      setPassword(savedPassword);
      setRememberPassword(true);
    }

    setPasswordCacheLoaded(true);
  }, []);

  useEffect(() => {
    if (!passwordCacheLoaded) {
      return;
    }

    if (rememberPassword && password) {
      window.localStorage.setItem(passwordStorageKey, password);
      return;
    }

    window.localStorage.removeItem(passwordStorageKey);
  }, [password, passwordCacheLoaded, rememberPassword]);

  const ttlMinutes = useDurationMinutes(durationValue, durationUnit);
  const extendTtlMinutes = useDurationMinutes(extendDurationValue, extendDurationUnit);
  const filteredLinks = useMemo(() => {
    const search = historySearch.trim().toLowerCase();

    if (!search) {
      return links;
    }

    return links.filter((link) =>
      [link.label, link.url, link.token].some(
        (value) => typeof value === "string" && value.toLowerCase().includes(search)
      )
    );
  }, [historySearch, links]);
  const historyPageCount = Math.max(1, Math.ceil(filteredLinks.length / historyPageSize));
  const visibleLinks = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return filteredLinks.slice(start, start + historyPageSize);
  }, [filteredLinks, historyPage]);
  const showHistoryControls = links.length > historyPageSize;

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, historyPageCount));
  }, [historyPageCount]);

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");
    setHistoryStatus("");
    setHistoryStatusKind("success");
    setIsSubmitting(true);

    const payload =
      expiryMode === "exact"
        ? {
            password,
            label,
            expiresAt: exactTime ? new Date(exactTime).toISOString() : ""
          }
        : {
            password,
            label,
            ttlMinutes
          };

    try {
      const data = await postLink("/api/links", payload, "生成链接失败");
      const nextLink = toGeneratedLink(data, {
        label: label.trim() || data.label,
        source: "created"
      });

      setLinks((current) => [nextLink, ...current]);
      setHistorySearch("");
      setHistoryPage(1);
      setStatus("链接已生成，已加入右侧列表");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成链接失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function queryExistingLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQueryError("");
    setQueryStatus("");
    setQueryResult(null);
    setHistoryStatus("");
    setHistoryStatusKind("success");
    setIsQuerying(true);

    try {
      const data = await postLinkStatus(
        "/api/link-status",
        {
          password,
          link: queryLinkInput
        },
        "查询链接失败"
      );

      setQueryResult(data);
      setQueryStatus(getLinkStatusMessage(data));
    } catch (caught) {
      setQueryError(caught instanceof Error ? caught.message : "查询链接失败");
    } finally {
      setIsQuerying(false);
    }
  }

  async function extendExistingLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExtendError("");
    setExtendStatus("");
    setHistoryStatus("");
    setHistoryStatusKind("success");
    setIsExtending(true);

    const payload =
      extendMode === "exact"
        ? {
            password,
            link: extendLinkInput,
            label: extendLabel,
            expiresAt: extendExactTime ? new Date(extendExactTime).toISOString() : ""
          }
        : {
            password,
            link: extendLinkInput,
            label: extendLabel,
            ttlMinutes: extendTtlMinutes
          };

    try {
      const data = await postLink("/api/extend-link", payload, "延长链接失败");
      const nextLink = toGeneratedLink(data, {
        label: extendLabel.trim() || data.label || "延长后的链接",
        source: "extended"
      });

      setLinks((current) => [nextLink, ...current]);
      setHistorySearch("");
      setHistoryPage(1);
      setExtendStatus(data.wasExpired ? "过期链接已延长，已生成新的替代链接" : "链接已延长，已生成新的替代链接");
    } catch (caught) {
      setExtendError(caught instanceof Error ? caught.message : "延长链接失败");
    } finally {
      setIsExtending(false);
    }
  }

  async function invalidateExistingLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInvalidateError("");
    setInvalidateStatus("");
    setHistoryStatus("");
    setHistoryStatusKind("success");
    setIsInvalidating(true);

    try {
      const data = await postInvalidateLink(
        "/api/invalidate-link",
        {
          password,
          link: invalidateLinkInput
        },
        "失效链接失败"
      );

      markLinkInvalidated(data.token as string, data.invalidatedAt as string);
      setInvalidateStatus(getInvalidateStatus(data));
    } catch (caught) {
      setInvalidateError(caught instanceof Error ? caught.message : "失效链接失败");
    } finally {
      setIsInvalidating(false);
    }
  }

  async function invalidateGeneratedLink(link: GeneratedLink) {
    setHistoryStatus("");
    setHistoryStatusKind("success");
    setInvalidatingToken(link.token);

    try {
      const data = await postInvalidateLink(
        "/api/invalidate-link",
        {
          password,
          token: link.token
        },
        "失效链接失败"
      );

      markLinkInvalidated(data.token as string, data.invalidatedAt as string);
      setHistoryStatusKind("success");
      setHistoryStatus(data.alreadyInvalidated ? "链接此前已失效" : "链接已失效");
    } catch (caught) {
      setHistoryStatusKind("error");
      setHistoryStatus(caught instanceof Error ? caught.message : "失效链接失败");
    } finally {
      setInvalidatingToken("");
    }
  }

  async function copyLink(url: string) {
    await navigator.clipboard.writeText(url);
    setHistoryStatusKind("success");
    setHistoryStatus("链接已复制");
  }

  async function copyQueriedLink() {
    const value = queryResult?.url || queryLinkInput.trim();

    if (!value) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setQueryStatus("链接已复制");
  }

  function downloadHistory() {
    try {
      const exportedAt = new Date();
      const file = createHistoryExport(links, historyExportFormat, exportedAt);
      const objectUrl = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
      const anchor = document.createElement("a");

      try {
        anchor.href = objectUrl;
        anchor.download = file.fileName;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }

      setHistoryStatusKind("success");
      setHistoryStatus(`已开始下载 ${links.length} 条（${historyExportFormat.toUpperCase()}）`);
    } catch {
      setHistoryStatusKind("error");
      setHistoryStatus("导出失败，请重试");
    }
  }

  function useQueriedLinkForExtend() {
    const value = queryResult?.url || queryLinkInput.trim();

    if (!value) {
      return;
    }

    setExtendLinkInput(value);
    setExtendLabel(queryResult?.label || "");
    setExtendError("");
    setExtendStatus("已填入查询到的链接");
    setWorkMode("extend");
  }

  function useQueriedLinkForInvalidate() {
    const value = queryResult?.url || queryLinkInput.trim();

    if (!value) {
      return;
    }

    setInvalidateLinkInput(value);
    setInvalidateError("");
    setInvalidateStatus("已填入查询到的链接");
    setWorkMode("invalidate");
  }

  function forgetSavedPassword() {
    window.localStorage.removeItem(passwordStorageKey);
    setRememberPassword(false);
    setPassword("");
    setHistoryStatusKind("success");
    setHistoryStatus("已清除当前浏览器缓存的管理员密码");
  }

  function markLinkInvalidated(token: string, invalidatedAt: string) {
    setLinks((current) =>
      current.map((link) => (link.token === token ? { ...link, invalidatedAt } : link))
    );
  }

  return (
    <main className="page-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <img src="/yaml-link-logo.png" alt="" width={44} height={44} />
            </span>
            <div>
              <strong>YAML Link Manager</strong>
              <span>限时 YAML 访问控制</span>
            </div>
          </div>
          <div className="header-status" aria-label="服务状态">
            <span aria-hidden="true" />
            服务端校验已启用
          </div>
        </div>
      </header>

      <section className="workspace" aria-label="YAML 链接工作台">
        <section className="tool-panel" aria-labelledby="tool-title">
          <div className="tool-tabs" role="tablist" aria-label="链接操作">
            <button
              type="button"
              role="tab"
              aria-selected={workMode === "create"}
              className={workMode === "create" ? "active" : ""}
              onClick={() => setWorkMode("create")}
            >
              生成新链接
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workMode === "query"}
              className={workMode === "query" ? "active" : ""}
              onClick={() => setWorkMode("query")}
            >
              查询有效期
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workMode === "extend"}
              className={workMode === "extend" ? "active" : ""}
              onClick={() => setWorkMode("extend")}
            >
              延长已有链接
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workMode === "invalidate"}
              className={workMode === "invalidate" ? "active" : ""}
              onClick={() => setWorkMode("invalidate")}
            >
              失效已有链接
            </button>
          </div>

          {workMode === "create" ? (
            <form className="tool-form" onSubmit={createLink}>
              <div className="form-title">
                <h1 id="tool-title">生成新链接</h1>
                <p>为当前 YAML 来源创建一个独立的限时访问地址。</p>
              </div>

              <div className="field-grid">
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  rememberPassword={rememberPassword}
                  onRememberChange={setRememberPassword}
                  onForget={forgetSavedPassword}
                />
                <TextField
                  label="链接备注"
                  value={label}
                  onChange={setLabel}
                  placeholder="例如：客户 A / 7 天"
                  maxLength={80}
                />
              </div>

              <ExpiryControls
                mode={expiryMode}
                setMode={setExpiryMode}
                durationValue={durationValue}
                setDurationValue={setDurationValue}
                durationUnit={durationUnit}
                setDurationUnit={setDurationUnit}
                exactTime={exactTime}
                setExactTime={setExactTime}
                durationLabel="有效期"
              />

              <button className="primary-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "生成中..." : "生成链接"}
              </button>

              {error ? <p className="message error">{error}</p> : null}
              {status ? <p className="message success">{status}</p> : null}
            </form>
          ) : workMode === "query" ? (
            <form className="tool-form" onSubmit={queryExistingLink}>
              <div className="form-title">
                <h1 id="tool-title">查询链接有效期</h1>
                <p>校验链接签名、过期时间和手动失效状态。</p>
              </div>

              <PasswordField
                value={password}
                onChange={setPassword}
                rememberPassword={rememberPassword}
                onRememberChange={setRememberPassword}
                onForget={forgetSavedPassword}
              />

              <TextField
                label="已有链接或 token"
                value={queryLinkInput}
                onChange={setQueryLinkInput}
                placeholder="https://.../api/subscription/eyJ2Ijox..."
                required
              />

              <button className="primary-button" type="submit" disabled={isQuerying}>
                {isQuerying ? "查询中..." : "查询有效期"}
              </button>

              {queryError ? <p className="message error">{queryError}</p> : null}
              {queryStatus ? <p className="message success">{queryStatus}</p> : null}
              {queryResult ? (
                <LinkStatusCard
                  result={queryResult}
                  onCopy={copyQueriedLink}
                  onExtend={useQueriedLinkForExtend}
                  onInvalidate={useQueriedLinkForInvalidate}
                />
              ) : null}
            </form>
          ) : workMode === "extend" ? (
            <form className="tool-form" onSubmit={extendExistingLink}>
              <div className="form-title">
                <h1 id="tool-title">延长已有链接</h1>
                <p>未过期链接从原过期时间继续增加；已过期链接从当前时间重新延长。</p>
              </div>

              <div className="field-grid">
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  rememberPassword={rememberPassword}
                  onRememberChange={setRememberPassword}
                  onForget={forgetSavedPassword}
                />
                <TextField
                  label="新备注"
                  value={extendLabel}
                  onChange={setExtendLabel}
                  placeholder="留空则沿用旧备注"
                  maxLength={80}
                />
              </div>

              <TextField
                label="已有链接或 token"
                value={extendLinkInput}
                onChange={setExtendLinkInput}
                placeholder="https://.../api/subscription/eyJ2Ijox..."
                required
              />

              <ExpiryControls
                mode={extendMode}
                setMode={setExtendMode}
                durationValue={extendDurationValue}
                setDurationValue={setExtendDurationValue}
                durationUnit={extendDurationUnit}
                setDurationUnit={setExtendDurationUnit}
                exactTime={extendExactTime}
                setExactTime={setExtendExactTime}
                durationLabel="增加时长"
              />

              <button className="primary-button" type="submit" disabled={isExtending}>
                {isExtending ? "延长中..." : "延长并生成新链接"}
              </button>

              {extendError ? <p className="message error">{extendError}</p> : null}
              {extendStatus ? <p className="message success">{extendStatus}</p> : null}
            </form>
          ) : (
            <form className="tool-form" onSubmit={invalidateExistingLink}>
              <div className="form-title">
                <h1 id="tool-title">失效已有链接</h1>
                <p>失效后，该链接再次访问会返回 410，不再暴露 YAML 内容。</p>
              </div>

              <PasswordField
                value={password}
                onChange={setPassword}
                rememberPassword={rememberPassword}
                onRememberChange={setRememberPassword}
                onForget={forgetSavedPassword}
              />

              <TextField
                label="已有链接或 token"
                value={invalidateLinkInput}
                onChange={setInvalidateLinkInput}
                placeholder="https://.../api/subscription/eyJ2Ijox..."
                required
              />

              <button className="primary-button danger-primary" type="submit" disabled={isInvalidating}>
                {isInvalidating ? "失效中..." : "确认失效"}
              </button>

              {invalidateError ? <p className="message error">{invalidateError}</p> : null}
              {invalidateStatus ? <p className="message success">{invalidateStatus}</p> : null}
            </form>
          )}
        </section>

        <section className="history-panel" aria-labelledby="history-title">
          <div className="panel-heading">
            <div>
              <h2 id="history-title">最近生成</h2>
              <p>永久保存在当前浏览器，共 {links.length} 条。</p>
            </div>
            <div className="history-actions">
              {historyStatus ? <span className={historyStatusKind === "error" ? "error" : undefined}>{historyStatus}</span> : null}
              {links.length > 0 ? (
                <>
                  <div className="history-export-controls">
                    <select
                      className="history-export-select"
                      aria-label="历史记录导出格式"
                      value={historyExportFormat}
                      onChange={(event) => setHistoryExportFormat(event.target.value as HistoryExportFormat)}
                    >
                      <option value="csv">CSV</option>
                      <option value="json">JSON</option>
                      <option value="txt">TXT</option>
                    </select>
                    <button
                      className="secondary-button"
                      type="button"
                      title="导出文件包含订阅链接，请妥善保管"
                      onClick={downloadHistory}
                    >
                      导出全部
                    </button>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setLinks([]);
                      setHistorySearch("");
                      setHistoryPage(1);
                    }}
                  >
                    清空
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {showHistoryControls ? (
            <div className="history-toolbar">
              <input
                aria-label="搜索历史链接"
                type="search"
                value={historySearch}
                onChange={(event) => {
                  setHistorySearch(event.target.value);
                  setHistoryPage(1);
                }}
                placeholder="搜索备注、链接或 token"
              />
              <span>{historySearch.trim() ? `找到 ${filteredLinks.length} 条` : `每页 ${historyPageSize} 条`}</span>
            </div>
          ) : null}

          {links.length === 0 ? (
            <div className="empty-state">
              <strong>还没有链接</strong>
              <span>生成或延长后会显示在这里。</span>
            </div>
          ) : filteredLinks.length === 0 ? (
            <div className="empty-state">
              <strong>没有匹配的链接</strong>
              <span>请尝试搜索其它备注、链接或 token。</span>
            </div>
          ) : (
            <>
              <div className="link-table" role="table" aria-label="最近生成的链接">
                <div className="link-table-head" role="row">
                  <span>备注</span>
                  <span>过期时间</span>
                  <span>链接</span>
                  <span>操作</span>
                </div>
                <div className="link-table-body">
                  {visibleLinks.map((link) => (
                    <article className={link.invalidatedAt ? "link-row invalidated" : "link-row"} role="row" key={link.token}>
                      <div className="link-meta" role="cell">
                        <div className="link-title-row">
                          <strong>{link.label || "未命名链接"}</strong>
                          {link.source === "extended" ? <b>已延长</b> : null}
                          {link.invalidatedAt ? <b className="danger">已失效</b> : null}
                        </div>
                        {link.previousExpiresAt ? (
                          <small>原过期：{new Date(link.previousExpiresAt).toLocaleString()}</small>
                        ) : null}
                        {link.invalidatedAt ? (
                          <small>失效：{new Date(link.invalidatedAt).toLocaleString()}</small>
                        ) : null}
                      </div>
                      <time role="cell" dateTime={link.expiresAt}>
                        {new Date(link.expiresAt).toLocaleString()}
                      </time>
                      <code role="cell">{link.url}</code>
                      <div className="row-actions" role="cell">
                        <button className="secondary-button compact" type="button" onClick={() => copyLink(link.url)}>
                          复制
                        </button>
                        <button
                          className="secondary-button compact danger-button"
                          type="button"
                          disabled={Boolean(link.invalidatedAt) || invalidatingToken === link.token}
                          onClick={() => invalidateGeneratedLink(link)}
                        >
                          {link.invalidatedAt ? "已失效" : invalidatingToken === link.token ? "处理中" : "失效"}
                        </button>
                        <a className="icon-link" href={link.url} target="_blank" rel="noreferrer" aria-label="打开链接">
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M14 5h5v5" />
                            <path d="m10 14 9-9" />
                            <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
                          </svg>
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
              {historyPageCount > 1 ? (
                <nav className="history-pagination" aria-label="历史链接分页">
                  <button
                    className="secondary-button compact"
                    type="button"
                    disabled={historyPage === 1}
                    onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                  >
                    上一页
                  </button>
                  <span aria-live="polite">
                    第 {historyPage} / {historyPageCount} 页
                  </span>
                  <button
                    className="secondary-button compact"
                    type="button"
                    disabled={historyPage === historyPageCount}
                    onClick={() => setHistoryPage((current) => Math.min(historyPageCount, current + 1))}
                  >
                    下一页
                  </button>
                </nav>
              ) : null}
            </>
          )}
        </section>
      </section>

      <footer className="app-footer">
        <span>请妥善保管管理员密码和 LINK_SECRET</span>
        <span>v0.1.0</span>
      </footer>
    </main>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  maxLength,
  required
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={maxLength}
      />
    </label>
  );
}

function PasswordField({
  value,
  onChange,
  rememberPassword,
  onRememberChange,
  onForget
}: {
  value: string;
  onChange: (value: string) => void;
  rememberPassword: boolean;
  onRememberChange: (value: boolean) => void;
  onForget: () => void;
}) {
  return (
    <div className="password-field">
      <TextField
        label="管理员密码"
        type="password"
        value={value}
        onChange={onChange}
        placeholder="ADMIN_PASSWORD"
        autoComplete="current-password"
        required
      />
      <div className="password-cache-row">
        <label>
          <input
            type="checkbox"
            checked={rememberPassword}
            onChange={(event) => onRememberChange(event.target.checked)}
          />
          <span>记住密码</span>
        </label>
        {rememberPassword ? (
          <button type="button" onClick={onForget}>
            清除缓存
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LinkStatusCard({
  result,
  onCopy,
  onExtend,
  onInvalidate
}: {
  result: LinkStatusResponse;
  onCopy: () => void;
  onExtend: () => void;
  onInvalidate: () => void;
}) {
  const status = getLinkStatus(result);
  const canExtend = status !== "invalidated";
  const canInvalidate = status === "active";

  return (
    <article className="status-card" aria-label="链接有效期查询结果">
      <div className="status-card-header">
        <div>
          <span className={`status-pill ${status}`}>{getLinkStatusLabel(result)}</span>
          <strong>{result.label || "未命名链接"}</strong>
        </div>
      </div>

      <div className="status-grid">
        <StatusMetric label="过期时间" value={formatDateTime(result.expiresAt)} />
        <StatusMetric label="剩余时间" value={getRemainingText(result)} />
        <StatusMetric label="创建时间" value={formatDateTime(result.issuedAt)} />
      </div>

      {result.url ? <code>{result.url}</code> : null}

      <div className="status-actions">
        <button className="secondary-button compact" type="button" onClick={onCopy}>
          复制
        </button>
        {canExtend ? (
          <button className="secondary-button compact" type="button" onClick={onExtend}>
            去延长
          </button>
        ) : null}
        {canInvalidate ? (
          <button className="secondary-button compact danger-button" type="button" onClick={onInvalidate}>
            去失效
          </button>
        ) : null}
      </div>
    </article>
  );
}

function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ExpiryControls({
  mode,
  setMode,
  durationValue,
  setDurationValue,
  durationUnit,
  setDurationUnit,
  exactTime,
  setExactTime,
  durationLabel
}: {
  mode: ExpiryMode;
  setMode: (mode: ExpiryMode) => void;
  durationValue: string;
  setDurationValue: (value: string) => void;
  durationUnit: ExpiryUnit;
  setDurationUnit: (unit: ExpiryUnit) => void;
  exactTime: string;
  setExactTime: (value: string) => void;
  durationLabel: string;
}) {
  return (
    <div className="expiry-block">
      <div className="segmented" aria-label="过期时间模式">
        <button
          type="button"
          className={mode === "duration" ? "active" : ""}
          onClick={() => setMode("duration")}
        >
          按时长
        </button>
        <button
          type="button"
          className={mode === "exact" ? "active" : ""}
          onClick={() => setMode("exact")}
        >
          指定时间
        </button>
      </div>

      {mode === "duration" ? (
        <div className="duration-row">
          <label className="field compact">
            <span>{durationLabel}</span>
            <input
              required
              min="1"
              step="1"
              type="number"
              value={durationValue}
              onChange={(event) => setDurationValue(event.target.value)}
            />
          </label>
          <label className="field compact">
            <span>单位</span>
            <select value={durationUnit} onChange={(event) => setDurationUnit(event.target.value as ExpiryUnit)}>
              <option value="minutes">分钟</option>
              <option value="hours">小时</option>
              <option value="days">天</option>
            </select>
          </label>
        </div>
      ) : (
        <label className="field">
          <span>新的过期时间</span>
          <input required type="datetime-local" value={exactTime} onChange={(event) => setExactTime(event.target.value)} />
        </label>
      )}
    </div>
  );
}

function useDurationMinutes(value: string, unit: ExpiryUnit): number {
  return useMemo(() => {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 0;
    }

    if (unit === "minutes") {
      return numericValue;
    }

    if (unit === "hours") {
      return numericValue * 60;
    }

    return numericValue * 24 * 60;
  }, [unit, value]);
}

async function postJson<T extends { error?: string }>(
  endpoint: string,
  payload: object,
  fallbackMessage: string
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as T;

  if (!response.ok) {
    throw new Error(data.error || fallbackMessage);
  }

  return data;
}

async function postLink(endpoint: string, payload: object, fallbackMessage: string): Promise<LinkResponse> {
  const data = await postJson<LinkResponse>(endpoint, payload, fallbackMessage);

  if (!data.url || !data.token || !data.expiresAt || !data.expiresInSeconds) {
    throw new Error("接口返回的数据不完整");
  }

  return data;
}

async function postLinkStatus(
  endpoint: string,
  payload: object,
  fallbackMessage: string
): Promise<LinkStatusResponse> {
  const data = await postJson<LinkStatusResponse>(endpoint, payload, fallbackMessage);

  if (
    !data.url ||
    !data.token ||
    !data.issuedAt ||
    !data.expiresAt ||
    typeof data.expiresInSeconds !== "number" ||
    !data.status
  ) {
    throw new Error("接口返回的数据不完整");
  }

  return data;
}

async function postInvalidateLink(
  endpoint: string,
  payload: object,
  fallbackMessage: string
): Promise<InvalidateResponse> {
  const data = await postJson<InvalidateResponse>(endpoint, payload, fallbackMessage);

  if (!data.token || !data.invalidatedAt || !data.expiresAt) {
    throw new Error("接口返回的数据不完整");
  }

  return data;
}

function getInvalidateStatus(data: InvalidateResponse): string {
  if (data.alreadyInvalidated) {
    return "链接此前已失效";
  }

  if (data.alreadyExpired) {
    return "链接已经过期，已记录为失效";
  }

  return "链接已失效";
}

function getLinkStatus(data: LinkStatusResponse): "active" | "expired" | "invalidated" {
  if (data.status) {
    return data.status;
  }

  if (data.invalidated) {
    return "invalidated";
  }

  return data.expired ? "expired" : "active";
}

function getLinkStatusLabel(data: LinkStatusResponse): string {
  const status = getLinkStatus(data);

  if (status === "invalidated") {
    return "已失效";
  }

  if (status === "expired") {
    return "已过期";
  }

  return "有效";
}

function getLinkStatusMessage(data: LinkStatusResponse): string {
  const status = getLinkStatus(data);

  if (status === "invalidated") {
    return "链接已手动失效，不能继续访问";
  }

  if (status === "expired") {
    return `链接已过期 ${formatDuration(Math.abs(data.expiresInSeconds || 0))}，可延长后生成替代链接`;
  }

  return `链接有效，剩余 ${formatDuration(data.expiresInSeconds || 0)}`;
}

function getRemainingText(data: LinkStatusResponse): string {
  const status = getLinkStatus(data);

  if (status === "invalidated") {
    return "已手动失效";
  }

  if (status === "expired") {
    return `已过期 ${formatDuration(Math.abs(data.expiresInSeconds || 0))}`;
  }

  return formatDuration(data.expiresInSeconds || 0);
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function formatDuration(totalSeconds: number): string {
  const roundedSeconds = Math.max(0, Math.floor(totalSeconds));

  if (roundedSeconds < 60) {
    return "不足 1 分钟";
  }

  const days = Math.floor(roundedSeconds / 86400);
  const hours = Math.floor((roundedSeconds % 86400) / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} 天`);
  }

  if (hours > 0) {
    parts.push(`${hours} 小时`);
  }

  if (minutes > 0 && parts.length < 2) {
    parts.push(`${minutes} 分钟`);
  }

  return parts.slice(0, 2).join(" ");
}

function createHistoryExport(
  links: GeneratedLink[],
  format: HistoryExportFormat,
  exportedAt: Date
): { content: string; fileName: string; mimeType: string } {
  const records = links.map(toHistoryExportRecord);
  const timestamp = exportedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
  const fileName = `yaml-link-history-${timestamp}.${format}`;

  if (format === "json") {
    return {
      content: `${JSON.stringify(records, null, 2)}\n`,
      fileName,
      mimeType: "application/json;charset=utf-8"
    };
  }

  if (format === "txt") {
    return {
      content: createHistoryText(records, exportedAt),
      fileName,
      mimeType: "text/plain;charset=utf-8"
    };
  }

  return {
    content: createHistoryCsv(records),
    fileName,
    mimeType: "text/csv;charset=utf-8"
  };
}

function toHistoryExportRecord(link: GeneratedLink): HistoryExportRecord {
  return {
    label: link.label,
    url: link.url,
    token: link.token,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    expiresInSeconds: link.expiresInSeconds,
    invalidatedAt: link.invalidatedAt,
    previousExpiresAt: link.previousExpiresAt,
    wasExpired: link.wasExpired,
    source: link.source
  };
}

function createHistoryCsv(records: HistoryExportRecord[]): string {
  const header = [
    "label",
    "url",
    "token",
    "createdAt",
    "expiresAt",
    "expiresInSeconds",
    "invalidatedAt",
    "previousExpiresAt",
    "wasExpired",
    "source"
  ];
  const rows = records.map((record) =>
    [
      record.label,
      record.url,
      record.token,
      record.createdAt,
      record.expiresAt,
      record.expiresInSeconds,
      record.invalidatedAt,
      record.previousExpiresAt,
      record.wasExpired,
      record.source
    ]
      .map(escapeCsvValue)
      .join(",")
  );

  return `\uFEFF${[header.map(escapeCsvValue).join(","), ...rows].join("\r\n")}\r\n`;
}

function escapeCsvValue(value: string | number | boolean | undefined): string {
  let text = value === undefined ? "" : String(value);

  if (typeof value === "string" && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) {
    text = `'${text}`;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function createHistoryText(records: HistoryExportRecord[], exportedAt: Date): string {
  const recordBlocks = records.map((record, index) =>
    [
      `记录 ${index + 1}`,
      `备注：${record.label ?? ""}`,
      `链接：${record.url}`,
      `Token：${record.token}`,
      `创建时间：${record.createdAt}`,
      `过期时间：${record.expiresAt}`,
      `生成时剩余秒数：${record.expiresInSeconds}`,
      `失效时间：${record.invalidatedAt ?? ""}`,
      `原过期时间：${record.previousExpiresAt ?? ""}`,
      `延长前是否过期：${record.wasExpired === undefined ? "" : record.wasExpired ? "是" : "否"}`,
      `来源：${record.source ?? ""}`
    ].join("\r\n")
  );

  return [
    "\uFEFFYAML Link Manager 历史记录",
    `导出时间：${exportedAt.toISOString()}`,
    `记录数量：${records.length}`,
    "",
    recordBlocks.join("\r\n\r\n---\r\n\r\n"),
    ""
  ].join("\r\n");
}

function toGeneratedLink(
  data: LinkResponse,
  options: {
    label?: string;
    source: "created" | "extended";
  }
): GeneratedLink {
  return {
    url: data.url as string,
    token: data.token as string,
    expiresAt: data.expiresAt as string,
    expiresInSeconds: data.expiresInSeconds as number,
    label: options.label || undefined,
    createdAt: new Date().toISOString(),
    previousExpiresAt: data.previousExpiresAt,
    wasExpired: data.wasExpired,
    source: options.source
  };
}

function isGeneratedLink(value: unknown): value is GeneratedLink {
  if (!value || typeof value !== "object") {
    return false;
  }

  const link = value as Partial<GeneratedLink>;

  return (
    typeof link.url === "string" &&
    link.url.length > 0 &&
    typeof link.token === "string" &&
    link.token.length > 0 &&
    typeof link.expiresAt === "string" &&
    typeof link.expiresInSeconds === "number" &&
    Number.isFinite(link.expiresInSeconds) &&
    typeof link.createdAt === "string" &&
    (link.label === undefined || typeof link.label === "string") &&
    (link.invalidatedAt === undefined || typeof link.invalidatedAt === "string") &&
    (link.previousExpiresAt === undefined || typeof link.previousExpiresAt === "string") &&
    (link.wasExpired === undefined || typeof link.wasExpired === "boolean") &&
    (link.source === undefined || link.source === "created" || link.source === "extended")
  );
}

function mergeGeneratedLinks(current: GeneratedLink[], incoming: GeneratedLink[]): GeneratedLink[] {
  const linksByToken = new Map<string, GeneratedLink>();

  for (const link of [...current, ...incoming]) {
    const existing = linksByToken.get(link.token);

    if (!existing) {
      linksByToken.set(link.token, link);
      continue;
    }

    if (!existing.invalidatedAt && link.invalidatedAt) {
      linksByToken.set(link.token, { ...existing, invalidatedAt: link.invalidatedAt });
    }
  }

  const merged = Array.from(linksByToken.values()).sort((left, right) => {
    const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
    return createdAtOrder || right.token.localeCompare(left.token);
  });

  return areGeneratedLinkListsEqual(merged, current) ? current : merged;
}

function areGeneratedLinkListsEqual(left: GeneratedLink[], right: GeneratedLink[]): boolean {
  return (
    left.length === right.length &&
    left.every((link, index) => {
      const other = right[index];

      return (
        link.url === other.url &&
        link.token === other.token &&
        link.expiresAt === other.expiresAt &&
        link.expiresInSeconds === other.expiresInSeconds &&
        link.label === other.label &&
        link.createdAt === other.createdAt &&
        link.invalidatedAt === other.invalidatedAt &&
        link.previousExpiresAt === other.previousExpiresAt &&
        link.wasExpired === other.wasExpired &&
        link.source === other.source
      );
    })
  );
}
