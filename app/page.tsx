"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type GeneratedLink = {
  url: string;
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
  label?: string;
  createdAt: string;
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
  const [links, setLinks] = useState<GeneratedLink[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const ttlMinutes = useMemo(() => {
    const numericValue = Number(durationValue);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 0;
    }

    if (durationUnit === "minutes") {
      return numericValue;
    }

    if (durationUnit === "hours") {
      return numericValue * 60;
    }

    return numericValue * 24 * 60;
  }, [durationUnit, durationValue]);

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
      const response = await fetch("/api/links", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = (await response.json()) as Partial<GeneratedLink> & { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "生成链接失败");
      }

      if (!data.url || !data.token || !data.expiresAt || !data.expiresInSeconds) {
        throw new Error("接口返回的数据不完整");
      }

      const nextLink: GeneratedLink = {
        url: data.url,
        token: data.token,
        expiresAt: data.expiresAt,
        expiresInSeconds: data.expiresInSeconds,
        label: label.trim() || undefined,
        createdAt: new Date().toISOString()
      };

      setLinks((current) => [nextLink, ...current].slice(0, 20));
      setStatus("链接已生成");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成链接失败");
    } finally {
      setIsSubmitting(false);
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
          <h1>生成限时 YAML 访问链接</h1>
          <p>
            链接只包含签名 token。访问时由服务端校验签名和过期时间，通过后才返回 YAML 内容。
          </p>
        </div>

        <form className="control-panel" onSubmit={createLink}>
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

          <div className="segmented" aria-label="过期时间模式">
            <button
              type="button"
              className={expiryMode === "duration" ? "active" : ""}
              onClick={() => setExpiryMode("duration")}
            >
              按时长
            </button>
            <button
              type="button"
              className={expiryMode === "exact" ? "active" : ""}
              onClick={() => setExpiryMode("exact")}
            >
              指定时间
            </button>
          </div>

          {expiryMode === "duration" ? (
            <div className="duration-row">
              <label className="field compact">
                <span>有效期</span>
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
                <select
                  value={durationUnit}
                  onChange={(event) => setDurationUnit(event.target.value as ExpiryUnit)}
                >
                  <option value="minutes">分钟</option>
                  <option value="hours">小时</option>
                  <option value="days">天</option>
                </select>
              </label>
            </div>
          ) : (
            <label className="field">
              <span>过期时间</span>
              <input
                required
                type="datetime-local"
                value={exactTime}
                onChange={(event) => setExactTime(event.target.value)}
              />
            </label>
          )}

          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "生成中..." : "生成链接"}
          </button>

          {error ? <p className="message error">{error}</p> : null}
          {status ? <p className="message success">{status}</p> : null}
        </form>

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
                    <span>{link.label || "未命名链接"}</span>
                    <time dateTime={link.expiresAt}>
                      过期：{new Date(link.expiresAt).toLocaleString()}
                    </time>
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
