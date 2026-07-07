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

type ExpiryUnit = "minutes" | "hours" | "days";
type ExpiryMode = "duration" | "exact";
type WorkMode = "create" | "extend" | "invalidate";
type MessageKind = "success" | "error";

const storageKey = "yaml-link-history";

export default function Home() {
  const [workMode, setWorkMode] = useState<WorkMode>("create");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("duration");
  const [durationValue, setDurationValue] = useState("24");
  const [durationUnit, setDurationUnit] = useState<ExpiryUnit>("hours");
  const [exactTime, setExactTime] = useState("");

  const [extendLinkInput, setExtendLinkInput] = useState("");
  const [extendLabel, setExtendLabel] = useState("");
  const [extendMode, setExtendMode] = useState<ExpiryMode>("duration");
  const [extendDurationValue, setExtendDurationValue] = useState("7");
  const [extendDurationUnit, setExtendDurationUnit] = useState<ExpiryUnit>("days");
  const [extendExactTime, setExtendExactTime] = useState("");
  const [invalidateLinkInput, setInvalidateLinkInput] = useState("");

  const [links, setLinks] = useState<GeneratedLink[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [extendError, setExtendError] = useState("");
  const [extendStatus, setExtendStatus] = useState("");
  const [invalidateError, setInvalidateError] = useState("");
  const [invalidateStatus, setInvalidateStatus] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyStatusKind, setHistoryStatusKind] = useState<MessageKind>("success");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExtending, setIsExtending] = useState(false);
  const [isInvalidating, setIsInvalidating] = useState(false);
  const [invalidatingToken, setInvalidatingToken] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);

    if (!saved) {
      return;
    }

    try {
      setLinks(JSON.parse(saved) as GeneratedLink[]);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(links.slice(0, 20)));
  }, [links]);

  const ttlMinutes = useDurationMinutes(durationValue, durationUnit);
  const extendTtlMinutes = useDurationMinutes(extendDurationValue, extendDurationUnit);

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

      setLinks((current) => [nextLink, ...current].slice(0, 20));
      setStatus("链接已生成，已加入右侧列表");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成链接失败");
    } finally {
      setIsSubmitting(false);
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

      setLinks((current) => [nextLink, ...current].slice(0, 20));
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
                <TextField
                  label="管理员密码"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="ADMIN_PASSWORD"
                  autoComplete="current-password"
                  required
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
          ) : workMode === "extend" ? (
            <form className="tool-form" onSubmit={extendExistingLink}>
              <div className="form-title">
                <h1 id="tool-title">延长已有链接</h1>
                <p>未过期链接从原过期时间继续增加；已过期链接从当前时间重新延长。</p>
              </div>

              <div className="field-grid">
                <TextField
                  label="管理员密码"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="ADMIN_PASSWORD"
                  autoComplete="current-password"
                  required
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

              <TextField
                label="管理员密码"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="ADMIN_PASSWORD"
                autoComplete="current-password"
                required
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
              <p>仅保存在当前浏览器，最多显示 20 条。</p>
            </div>
            <div className="history-actions">
              {historyStatus ? <span className={historyStatusKind === "error" ? "error" : undefined}>{historyStatus}</span> : null}
              {links.length > 0 ? (
                <button className="secondary-button" type="button" onClick={() => setLinks([])}>
                  清空
                </button>
              ) : null}
            </div>
          </div>

          {links.length === 0 ? (
            <div className="empty-state">
              <strong>还没有链接</strong>
              <span>生成或延长后会显示在这里。</span>
            </div>
          ) : (
            <div className="link-table" role="table" aria-label="最近生成的链接">
              <div className="link-table-head" role="row">
                <span>备注</span>
                <span>过期时间</span>
                <span>链接</span>
                <span>操作</span>
              </div>
              <div className="link-table-body">
                {links.map((link) => (
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
