"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type GeneratedLink = {
  url: string;
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
  label?: string;
  createdAt: string;
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

type ExpiryUnit = "minutes" | "hours" | "days";
type ExpiryMode = "duration" | "exact";

const storageKey = "yaml-link-history";

export default function Home() {
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

  const [links, setLinks] = useState<GeneratedLink[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [extendError, setExtendError] = useState("");
  const [extendStatus, setExtendStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExtending, setIsExtending] = useState(false);

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
      setStatus("链接已生成");
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

  async function copyLink(url: string) {
    await navigator.clipboard.writeText(url);
    setStatus("链接已复制");
  }

  return (
    <main className="page-shell">
      <section className="workspace">
        <div className="intro-panel">
          <div className="brand-row">
            <span className="brand-mark" aria-hidden="true">
              Y
            </span>
            <span className="brand-name">YAML Link Manager</span>
          </div>
          <h1>管理限时 YAML 访问链接</h1>
          <p>
            生成新链接，或粘贴已有链接延长有效期。每次延长都会生成一个新的替代链接，旧链接不会被原地修改。
          </p>
        </div>

        <div className="form-column">
          <form className="control-panel" onSubmit={createLink}>
            <div className="form-title">
              <h2>生成新链接</h2>
              <p>为 YAML 内容创建一个独立的限时访问地址。</p>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>管理员密码</span>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="ADMIN_PASSWORD"
                />
              </label>

              <label className="field">
                <span>链接备注</span>
                <input
                  type="text"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="例如：客户 A / 7 天"
                  maxLength={80}
                />
              </label>
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

          <form className="control-panel" onSubmit={extendExistingLink}>
            <div className="form-title">
              <h2>延长已有链接</h2>
              <p>粘贴完整链接或 token。未过期链接从原过期时间继续增加，已过期链接从现在开始延长。</p>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>管理员密码</span>
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="ADMIN_PASSWORD"
                />
              </label>

              <label className="field">
                <span>新备注</span>
                <input
                  type="text"
                  value={extendLabel}
                  onChange={(event) => setExtendLabel(event.target.value)}
                  placeholder="留空则沿用旧备注"
                  maxLength={80}
                />
              </label>
            </div>

            <label className="field">
              <span>已有链接或 token</span>
              <input
                required
                type="text"
                value={extendLinkInput}
                onChange={(event) => setExtendLinkInput(event.target.value)}
                placeholder="https://.../api/subscription/eyJ2Ijox..."
              />
            </label>

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
        </div>

        <section className="link-panel" aria-labelledby="history-title">
          <div className="panel-heading">
            <div>
              <h2 id="history-title">最近生成</h2>
              <p>历史只保存在当前浏览器，本项目不依赖数据库。</p>
            </div>
            {links.length > 0 ? (
              <button className="secondary-button" type="button" onClick={() => setLinks([])}>
                清空
              </button>
            ) : null}
          </div>

          {links.length === 0 ? (
            <div className="empty-state">还没有生成链接</div>
          ) : (
            <div className="link-list">
              {links.map((link) => (
                <article className="link-item" key={link.token}>
                  <div className="link-meta">
                    <div className="link-title-row">
                      <span>{link.label || "未命名链接"}</span>
                      {link.source === "extended" ? <b>已延长</b> : null}
                    </div>
                    <time dateTime={link.expiresAt}>
                      过期：{new Date(link.expiresAt).toLocaleString()}
                    </time>
                    {link.previousExpiresAt ? (
                      <small>原过期：{new Date(link.previousExpiresAt).toLocaleString()}</small>
                    ) : null}
                  </div>
                  <code>{link.url}</code>
                  <button className="secondary-button" type="button" onClick={() => copyLink(link.url)}>
                    复制
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
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
    <>
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
    </>
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

async function postLink(endpoint: string, payload: object, fallbackMessage: string): Promise<LinkResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as LinkResponse;

  if (!response.ok) {
    throw new Error(data.error || fallbackMessage);
  }

  if (!data.url || !data.token || !data.expiresAt || !data.expiresInSeconds) {
    throw new Error("接口返回的数据不完整");
  }

  return data;
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
