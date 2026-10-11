"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AutomaticSyncHttpError,
  AutomaticSyncState,
  createAutomaticSubscriptionSync
} from "../lib/automatic-subscription-sync";

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
  urls?: string[];
};

type LinkResponse = {
  url?: string;
  token?: string;
  label?: string;
  expiresAt?: string;
  expiresInSeconds?: number;
  previousExpiresAt?: string;
  wasExpired?: boolean;
  unchangedUrl?: boolean;
  createdAt?: string;
  urls?: string[];
  error?: string;
};

type SubscriptionsResponse = {
  configured: boolean;
  links?: GeneratedLink[];
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
type HistoryFilter = "all" | "active" | "expired" | "invalidated";

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
  urls?: string[];
};

const storageKey = "yaml-link-history";
const passwordStorageKey = "yaml-link-admin-password";
const historyPageSize = 20;

export default function Home() {
  const [workMode, setWorkMode] = useState<WorkMode>("create");
  const [isToolOpen, setIsToolOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(true);
  const toolDialog = useRef<HTMLDialogElement>(null);
  const [createdLink, setCreatedLink] = useState<GeneratedLink | null>(null);
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
  const [historyCacheWritable, setHistoryCacheWritable] = useState(false);
  const [historyCacheWarning, setHistoryCacheWarning] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
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
  const [cloudConfigured, setCloudConfigured] = useState<boolean | null>(null);
  const [cloudSyncState, setCloudSyncState] = useState<AutomaticSyncState>({ phase: "idle", lastSyncedAt: null });
  const syncController = useRef<ReturnType<typeof createAutomaticSubscriptionSync<SubscriptionsResponse>> | null>(null);
  const passwordValue = useRef("");
  const extensionAttempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const isMutating = isSubmitting || isExtending || isInvalidating || Boolean(invalidatingToken);

  function openTool(mode: WorkMode) {
    if (mode === "create" && !isToolOpen) {
      setCreatedLink(null);
      setError("");
      setStatus("");
    }
    setWorkMode(mode);
    setIsToolOpen(true);
  }

  useEffect(() => {
    const dialog = toolDialog.current;
    if (!isToolOpen || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && previousFocus.getClientRects().length > 0 && !previousFocus.matches(":disabled")) {
        previousFocus.focus({ preventScroll: true });
      } else {
        document.querySelector<HTMLButtonElement>(".workspace-actions .primary-button")?.focus({ preventScroll: true });
      }
    };
  }, [isToolOpen]);

  useEffect(() => {
    if (isToolOpen && toolDialog.current) toolDialog.current.scrollTop = 0;
  }, [isToolOpen, workMode]);

  function updateAdminPassword(value: string) {
    if (passwordValue.current !== value) {
      passwordValue.current = value;
      setCloudConfigured(null);
      syncController.current?.setPassword(value);
    }

    setPassword(value);
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);

      if (saved) {
        const parsed: unknown = JSON.parse(saved);

        if (!Array.isArray(parsed)) {
          throw new Error("历史缓存格式无效");
        }

        const storedLinks = parsed.filter(isGeneratedLink);
        setLinks(mergeGeneratedLinks([], storedLinks));

        if (storedLinks.length !== parsed.length) {
          throw new Error("历史缓存包含无法识别的记录");
        }
      }
      setHistoryCacheWritable(true);
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : "历史缓存读取失败";
      setHistoryCacheWarning(`${reason}。原始缓存已保留，本次暂停自动写入；请先备份浏览器缓存再处理。`);
    } finally {
      setHistoryCacheLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!historyCacheLoaded || !historyCacheWritable) {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(links));
    } catch {
      setHistoryStatusKind("error");
      setHistoryStatus("历史缓存写入失败，请检查浏览器存储空间");
    }
  }, [historyCacheLoaded, historyCacheWritable, links]);

  useEffect(() => {
    function syncHistoryAcrossTabs(event: StorageEvent) {
      if (event.key !== storageKey || event.storageArea !== window.localStorage) {
        return;
      }

      try {
        const parsed: unknown = event.newValue ? JSON.parse(event.newValue) : [];

        if (!Array.isArray(parsed) || !parsed.every(isGeneratedLink)) {
          throw new Error("其它标签页写入了无法识别的历史缓存");
        }

        if (parsed.length === 0) {
          setLinks([]);
          setHistorySearch("");
          setHistoryFilter("all");
          setHistoryPage(1);
          return;
        }

        setLinks((current) => mergeGeneratedLinks(current, parsed));
      } catch {
        setHistoryCacheWritable(false);
        setHistoryCacheWarning("其它标签页的历史缓存读取异常，原始缓存已保留，本次暂停自动写入。");
      }
    }

    window.addEventListener("storage", syncHistoryAcrossTabs);
    return () => window.removeEventListener("storage", syncHistoryAcrossTabs);
  }, []);

  useEffect(() => {
    extensionAttempt.current = null;
  }, [password, extendLinkInput, extendLabel, extendMode, extendDurationValue, extendDurationUnit, extendExactTime]);

  useEffect(() => {
    try {
      const savedPassword = window.localStorage.getItem(passwordStorageKey);

      if (savedPassword) {
        updateAdminPassword(savedPassword);
        setRememberPassword(true);
        setIsAdminOpen(false);
      }
    } catch {
      setHistoryStatusKind("error");
      setHistoryStatus("浏览器密码缓存不可用，请手动输入管理员密码");
    } finally {
      setPasswordCacheLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!passwordCacheLoaded) {
      return;
    }

    try {
      if (rememberPassword && password) {
        window.localStorage.setItem(passwordStorageKey, password);
        return;
      }

      window.localStorage.removeItem(passwordStorageKey);
    } catch {
      setHistoryStatusKind("error");
      setHistoryStatus("浏览器密码缓存写入失败，本次仍可使用已输入的密码");
    }
  }, [password, passwordCacheLoaded, rememberPassword]);

  useEffect(() => {
    if (!historyCacheLoaded || !passwordCacheLoaded) return;

    const controller = createAutomaticSubscriptionSync<SubscriptionsResponse>({
      load: async (adminPassword, signal) => {
        const response = await fetch("/api/subscriptions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: adminPassword, action: "list" }),
          signal,
          cache: "no-store"
        });
        const data = (await response.json()) as SubscriptionsResponse;

        if (!response.ok) {
          throw new AutomaticSyncHttpError(response.status, data.error || "读取 GitHub 数据失败");
        }

        if (typeof data.configured !== "boolean") {
          throw new Error("GitHub 返回的订阅数据格式不完整");
        }

        if (data.configured) getCloudLinks(data);
        return data;
      },
      onData: (data) => {
        setCloudConfigured(data.configured);
        if (data.configured) setLinks((current) => mergeCloudGeneratedLinks(current, getCloudLinks(data)));
      },
      onState: setCloudSyncState,
      isVisible: () => document.visibilityState !== "hidden"
    });
    syncController.current = controller;
    controller.setPassword(passwordValue.current);
    const refreshOnVisibility = () => controller.visibilityChanged();
    document.addEventListener("visibilitychange", refreshOnVisibility);

    return () => {
      controller.stop();
      if (syncController.current === controller) syncController.current = null;
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [historyCacheLoaded, passwordCacheLoaded]);

  const ttlMinutes = useDurationMinutes(durationValue, durationUnit);
  const extendTtlMinutes = useDurationMinutes(extendDurationValue, extendDurationUnit);
  const viewNow = Date.now();
  const search = historySearch.trim().toLowerCase();
  const filteredLinks = links.filter((link) =>
      (historyFilter === "all" || getStoredLinkStatus(link, viewNow) === historyFilter) &&
      (!search || [link.label, link.url, link.token].some(
        (value) => typeof value === "string" && value.toLowerCase().includes(search)
      ))
  );
  const historyCounts = { all: links.length, active: 0, expired: 0, invalidated: 0 };
  for (const link of links) historyCounts[getStoredLinkStatus(link, viewNow)] += 1;
  const historyPageCount = Math.max(1, Math.ceil(filteredLinks.length / historyPageSize));
  const start = (historyPage - 1) * historyPageSize;
  const visibleLinks = filteredLinks.slice(start, start + historyPageSize);
  const showHistoryControls = links.length > 0;

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, historyPageCount));
  }, [historyPageCount]);

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatedLink(null);
    syncController.current?.beginMutation();
    setError("");
    setStatus("");
    setHistoryStatus("");
    setHistoryStatusKind("success");
    setIsSubmitting(true);

    try {
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
      const data = await postLink("/api/links", payload, "生成链接失败");
      const nextLink = toGeneratedLink(data, {
        label: label.trim() || data.label,
        source: "created"
      });

      setLinks((current) => mergeCloudGeneratedLinks(current, [nextLink]));
      setCreatedLink(nextLink);
      setHistorySearch("");
      setHistoryFilter("all");
      setHistoryPage(1);
      setStatus("链接已生成，已加入订阅列表");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成链接失败");
    } finally {
      setIsSubmitting(false);
      syncController.current?.endMutation();
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
    syncController.current?.beginMutation();
    setExtendError("");
    setExtendStatus("");
    setHistoryStatus("");
    setHistoryStatusKind("success");
    setIsExtending(true);

    try {
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
      const fingerprint = JSON.stringify(payload);

      if (extensionAttempt.current?.fingerprint !== fingerprint) {
        extensionAttempt.current = { fingerprint, operationId: crypto.randomUUID() };
      }

      const data = await postLink(
        "/api/extend-link",
        { ...payload, operationId: extensionAttempt.current.operationId },
        "延长链接失败"
      );
      const nextLink = toGeneratedLink(data, {
        label: extendLabel.trim() || data.label || "延长后的链接",
        source: "extended"
      });

      extensionAttempt.current = null;
      setLinks((current) => mergeCloudGeneratedLinks(current, [nextLink]));
      setQueryResult(null);
      setQueryStatus("");
      setHistorySearch("");
      setHistoryFilter("all");
      setHistoryPage(1);
      setExtendStatus(
        data.unchangedUrl
          ? "有效期已更新并保存到 GitHub，原订阅链接保持不变"
          : data.wasExpired
            ? "过期链接已延长，已生成新的替代链接"
            : "链接已延长，已生成新的替代链接"
      );
    } catch (caught) {
      setExtendError(caught instanceof Error ? caught.message : "延长链接失败");
    } finally {
      setIsExtending(false);
      syncController.current?.endMutation();
    }
  }

  async function invalidateExistingLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    syncController.current?.beginMutation();
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
      syncController.current?.endMutation();
    }
  }

  async function invalidateGeneratedLink(link: GeneratedLink) {
    syncController.current?.beginMutation();
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
      syncController.current?.endMutation();
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
    openTool("extend");
  }

  function useGeneratedLinkForExtend(link: GeneratedLink) {
    setExtendLinkInput(link.url);
    setExtendLabel(link.label || "");
    setExtendError("");
    setExtendStatus("已填入列表中的链接，可设置增加时长或新的到期时间");
    openTool("extend");
  }

  function useQueriedLinkForInvalidate() {
    const value = queryResult?.url || queryLinkInput.trim();

    if (!value) {
      return;
    }

    setInvalidateLinkInput(value);
    setInvalidateError("");
    setInvalidateStatus("已填入查询到的链接");
    openTool("invalidate");
  }

  function forgetSavedPassword() {
    setRememberPassword(false);
    updateAdminPassword("");

    try {
      window.localStorage.removeItem(passwordStorageKey);
      setHistoryStatusKind("success");
      setHistoryStatus("已清除当前浏览器缓存的管理员密码");
    } catch {
      setHistoryStatusKind("error");
      setHistoryStatus("清除密码缓存失败，请检查浏览器存储权限");
    }
  }

  function markLinkInvalidated(token: string, invalidatedAt: string) {
    setLinks((current) =>
      current.map((link) => (link.token === token ? { ...link, invalidatedAt } : link))
    );
    setQueryResult(null);
    setQueryStatus("");
  }

  function clearLocalHistory() {
    try {
      window.localStorage.setItem(storageKey, "[]");
      setLinks([]);
      setHistoryCacheWritable(true);
      setHistoryCacheWarning("");
      setHistorySearch("");
      setHistoryFilter("all");
      setHistoryPage(1);
      setHistoryStatusKind("success");
      setHistoryStatus("本地缓存已清理，点击刷新列表可恢复 GitHub 中的订阅");
    } catch {
      setHistoryStatusKind("error");
      setHistoryStatus("清空本地列表失败，原缓存已保留");
    }
  }

  return (
    <main className="page-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true"><img src="/yaml-link-logo.png" alt="" width={44} height={44} /></span>
            <div>
              <span className="brand-eyebrow" aria-hidden="true">Brclio / Tools</span>
              <strong>YAML Link Manager</strong>
              <span>限时订阅管理</span>
            </div>
          </div>
          <div className="header-status" aria-label="服务状态"><span aria-hidden="true" />服务端校验已启用</div>
        </div>
      </header>

      <section className="workspace" aria-label="YAML 链接工作台">
        <div className="workspace-heading">
          <div>
            <span className="panel-eyebrow" aria-hidden="true">Subscription workspace</span>
            <h1>订阅工作台</h1>
            <p>找到订阅，继续管理。续期后，原链接保持不变。</p>
          </div>
          <div className="workspace-actions">
            <button className="secondary-button" type="button" onClick={() => openTool("query")}><ActionIcon kind="search" />查询链接</button>
            <button className="primary-button" type="button" onClick={() => openTool("create")}><ActionIcon kind="plus" />新建订阅</button>
          </div>
        </div>

        <details className="admin-panel" open={isAdminOpen} onToggle={(event) => setIsAdminOpen(event.currentTarget.open)}>
          <summary>
            <span className="admin-summary-title"><ActionIcon kind="lock" />管理员与存储</span>
            <span className={`cloud-state${cloudSyncState.phase === "connected" && cloudConfigured ? " configured" : cloudSyncState.phase === "error" || cloudSyncState.phase === "auth-error" ? " error" : ""}`} role="status">{getAutomaticSyncLabel(cloudSyncState, cloudConfigured)}</span>
            <span className="cloud-last-synced">最近同步：{cloudConfigured && cloudSyncState.lastSyncedAt !== null ? new Date(cloudSyncState.lastSyncedAt).toLocaleTimeString() : "尚未同步"}</span>
          </summary>
          <div className="admin-panel-content">
            {!isToolOpen ? <PasswordField value={password} onChange={updateAdminPassword} rememberPassword={rememberPassword} onRememberChange={setRememberPassword} onForget={forgetSavedPassword} /> : <p>可在当前操作面板中修改管理员密码。</p>}
            <div className="admin-help">
              <strong>使用 GitHub 私有仓库存储</strong>
              <p>输入管理员密码后读取一次。创建、续期和关闭会立即保存并更新列表；需要查看其他设备的修改时，点击刷新列表。</p>
            </div>
          </div>
        </details>

        <div className="feedback-region" aria-live="polite">
          {cloudSyncState.error ? <p className="message error">{cloudSyncState.error}。{cloudSyncState.phase === "auth-error" ? "请检查管理员密码后点击刷新列表。" : "缓存已保留，请点击刷新列表重试。"}</p> : null}
          {cloudConfigured === false ? <p className="message error">服务端尚未配置 GitHub 私有仓库存储，浏览器缓存已保留。</p> : null}
          {historyCacheWarning ? <p className="message error" role="alert">{historyCacheWarning}</p> : null}
          {historyStatus ? <p className={`message ${historyStatusKind}`} role="status">{historyStatus}</p> : null}
        </div>

        <section className="history-panel" aria-labelledby="history-title">
          <div className="panel-heading">
            <div><h2 id="history-title">订阅列表</h2><p>共 {links.length} 条订阅 · 操作后更新，按需刷新</p></div>
            <div className="history-actions">
              <button className="secondary-button cloud-refresh-button" type="button" disabled={!historyCacheLoaded || !passwordCacheLoaded || !password || isMutating || cloudSyncState.phase === "refreshing" || cloudSyncState.phase === "waiting"} onClick={() => syncController.current?.manualRefresh()}><ActionIcon kind="refresh" />{cloudSyncState.phase === "refreshing" ? "读取中…" : "刷新列表"}</button>
              <details className="utilities-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
                <summary>更多操作<ActionIcon kind="chevron" /></summary>
                <div className="utilities-content">
                  <div className="utilities-heading">
                    <strong>导出与本机缓存</strong>
                    <button className="secondary-button compact utilities-close" type="button" onClick={(event) => {
                      const menu = event.currentTarget.closest("details");
                      if (menu) { menu.open = false; menu.querySelector("summary")?.focus(); }
                    }}>收起<ActionIcon kind="close" /></button>
                  </div>
                  <div className="history-export-controls">
                    <select className="history-export-select" aria-label="历史记录导出格式" value={historyExportFormat} onChange={(event) => setHistoryExportFormat(event.target.value as HistoryExportFormat)}><option value="csv">CSV</option><option value="json">JSON</option><option value="txt">TXT</option></select>
                    <button className="secondary-button" type="button" disabled={links.length === 0} title="导出文件包含订阅链接，请妥善保管" onClick={downloadHistory}>导出全部</button>
                  </div>
                  <button className="secondary-button" type="button" disabled={isMutating || links.length === 0} onClick={clearLocalHistory}>清空本地列表</button>
                  <p>仅清理当前浏览器缓存，云端订阅保留。</p>
                  <button className="secondary-button" type="button" onClick={() => openTool("extend")}>手动输入链接续期</button>
                  <button className="secondary-button danger-button" type="button" onClick={() => openTool("invalidate")}>手动输入链接失效</button>
                </div>
              </details>
            </div>
          </div>

          {showHistoryControls ? (
            <>
              <div className="history-toolbar">
                <label className="search-field"><ActionIcon kind="search" /><input aria-label="搜索历史链接" type="search" value={historySearch} onChange={(event) => { setHistorySearch(event.target.value); setHistoryPage(1); }} placeholder="搜索备注、链接或 token" /></label>
                <span>{historySearch.trim() || historyFilter !== "all" ? `找到 ${filteredLinks.length} 条` : `每页 ${historyPageSize} 条`}</span>
              </div>
              <div className="history-filters" role="group" aria-label="按订阅状态筛选">
                {([ ["all", "全部"], ["active", "使用中"], ["expired", "已过期"], ["invalidated", "已失效"] ] as const).map(([value, text]) => (
                  <button type="button" key={value} aria-pressed={historyFilter === value} onClick={() => { setHistoryFilter(value); setHistoryPage(1); }}>{text}<span>{historyCounts[value]}</span></button>
                ))}
              </div>
            </>
          ) : null}

          {links.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-mark" aria-hidden="true"><ActionIcon kind="link" /></span>
              <strong>从第一条订阅开始</strong>
              <span>输入管理员密码读取已有订阅，或新建一个限时访问链接。</span>
              <button className="primary-button" type="button" onClick={() => openTool("create")}>新建订阅</button>
            </div>
          ) : filteredLinks.length === 0 ? (
            <div className="empty-state"><strong>没有匹配的订阅</strong><span>试试其他关键词，或切换订阅状态。</span><button className="secondary-button" type="button" onClick={() => { setHistorySearch(""); setHistoryFilter("all"); setHistoryPage(1); }}>重置筛选</button></div>
          ) : (
            <>
              <div className="link-table" role="table" aria-label="订阅列表">
                <div className="link-table-head" role="row"><span role="columnheader">订阅</span><span role="columnheader">过期时间</span><span role="columnheader">订阅地址</span><span role="columnheader">操作</span></div>
                <div className="link-table-body">
                  {visibleLinks.map((link) => (
                    <article className={link.invalidatedAt ? "link-row invalidated" : "link-row"} role="row" key={link.token}>
                      <div className="link-meta" role="cell">
                        <div className="link-title-row"><strong>{link.label || "未命名链接"}</strong><span className={`status-pill ${getStoredLinkStatus(link, viewNow)}`}>{link.invalidatedAt ? "已失效" : getStoredLinkStatus(link, viewNow) === "expired" ? "已过期" : "使用中"}</span>{link.source === "extended" ? <b>已延长</b> : null}</div>
                        {link.previousExpiresAt ? <small>原过期：{new Date(link.previousExpiresAt).toLocaleString()}</small> : null}
                        {link.invalidatedAt ? <small>失效：{new Date(link.invalidatedAt).toLocaleString()}</small> : null}
                      </div>
                      <time role="cell" dateTime={link.expiresAt}><small>到期时间</small><span>{new Date(link.expiresAt).toLocaleString()}</span></time>
                      <div className="link-address" role="cell"><span className="link-domain">{getSubscriptionHost(link.url)}</span><details className="link-url-details"><summary>查看完整链接</summary><code>{link.url}</code></details></div>
                      <div className="row-actions" role="cell">
                        <button className="secondary-button compact" type="button" onClick={() => copyLink(link.url)}>复制</button>
                        <button className="secondary-button compact" type="button" disabled={Boolean(link.invalidatedAt) || isMutating} onClick={() => useGeneratedLinkForExtend(link)}>续期</button>
                        <button className="secondary-button compact danger-button" type="button" disabled={Boolean(link.invalidatedAt) || isMutating} onClick={() => invalidateGeneratedLink(link)}>{link.invalidatedAt ? "已失效" : invalidatingToken === link.token ? "处理中" : "失效"}</button>
                        <a className="icon-link" href={link.url} target="_blank" rel="noreferrer" aria-label="打开链接"><ActionIcon kind="external" /></a>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
              {historyPageCount > 1 ? (
                <nav className="history-pagination" aria-label="历史链接分页">
                  <button className="secondary-button compact" type="button" disabled={historyPage === 1} onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}>上一页</button>
                  <span aria-live="polite">第 {historyPage} / {historyPageCount} 页</span>
                  <button className="secondary-button compact" type="button" disabled={historyPage === historyPageCount} onClick={() => setHistoryPage((current) => Math.min(historyPageCount, current + 1))}>下一页</button>
                </nav>
              ) : null}
            </>
          )}
        </section>
      </section>

      <nav className="mobile-nav" aria-label="工作台快捷操作">
        <button type="button" aria-current={!isToolOpen ? "page" : undefined} onClick={() => { setIsToolOpen(false); document.getElementById("history-title")?.scrollIntoView({ block: "start" }); }}><ActionIcon kind="list" /><span>订阅</span></button>
        <button type="button" onClick={() => openTool("create")}><ActionIcon kind="plus" /><span>新建</span></button>
        <button type="button" onClick={() => openTool("query")}><ActionIcon kind="search" /><span>查询</span></button>
      </nav>

      <dialog className="tool-dialog" ref={toolDialog} aria-labelledby="tool-title" onCancel={(event) => { event.preventDefault(); if (!isMutating && !isQuerying) setIsToolOpen(false); }} onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
        if (event.target === event.currentTarget && outside && !isMutating && !isQuerying) setIsToolOpen(false);
      }}>
        <div className="dialog-header"><span>链接操作</span><button className="dialog-close secondary-button" type="button" autoFocus disabled={isMutating || isQuerying} onClick={() => setIsToolOpen(false)}><ActionIcon kind="close" />返回列表</button></div>
        <section className="tool-panel">
          <div className="tool-tabs" role="tablist" aria-label="链接操作" onKeyDown={(event) => {
            if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
            const modes: WorkMode[] = ["create", "query", "extend", "invalidate"];
            const index = modes.indexOf(workMode);
            const next = event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : -1;
            if (next < 0) return;
            event.preventDefault();
            setWorkMode(modes[next]);
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
          }}>
            {([ ["create", "生成新链接"], ["query", "查询有效期"], ["extend", "延长已有链接"], ["invalidate", "失效已有链接"] ] as const).map(([mode, text]) => <button type="button" role="tab" key={mode} aria-selected={workMode === mode} tabIndex={workMode === mode ? 0 : -1} className={workMode === mode ? "active" : ""} onClick={() => setWorkMode(mode)}>{text}</button>)}
          </div>
          {isToolOpen ? <>
          {workMode === "create" ? (
            <form className="tool-form" onSubmit={createLink}>
              <div className="form-title">
                <span className="panel-eyebrow" aria-hidden="true">Create a link</span>
                <h2 id="tool-title">生成新链接</h2>
                <p>为当前 YAML 来源创建一个独立的限时访问地址。</p>
              </div>

              <div className="field-grid">
                <PasswordField
                  value={password}
                  onChange={updateAdminPassword}
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

              {error ? <p className="message error" role="alert">{error}</p> : null}
              {status ? <p className="message success" role="status">{status}</p> : null}
              {createdLink ? (
                <article className="status-card" aria-label="新建订阅结果">
                  <strong>{createdLink.label || "新订阅已创建"}</strong>
                  <code>{createdLink.url}</code>
                  <div className="status-actions">
                    <button className="secondary-button" type="button" onClick={async () => { await copyLink(createdLink.url); setStatus("链接已复制"); }}>复制新链接</button>
                    <button className="secondary-button" type="button" disabled={isMutating || isQuerying} onClick={() => setIsToolOpen(false)}>返回列表</button>
                  </div>
                </article>
              ) : null}
            </form>
          ) : workMode === "query" ? (
            <form className="tool-form" onSubmit={queryExistingLink}>
              <div className="form-title">
                <span className="panel-eyebrow" aria-hidden="true">Check access</span>
                <h2 id="tool-title">查询链接有效期</h2>
                <p>校验链接签名、过期时间和手动失效状态。</p>
              </div>

              <PasswordField
                value={password}
                onChange={updateAdminPassword}
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

              {queryError ? <p className="message error" role="alert">{queryError}</p> : null}
              {queryStatus ? <p className="message success" role="status">{queryStatus}</p> : null}
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
                <span className="panel-eyebrow" aria-hidden="true">Extend access</span>
                <h2 id="tool-title">延长已有链接</h2>
                <p>未过期链接从原过期时间继续增加；已过期链接从当前时间重新延长。启用 GitHub 存储后，原链接保持不变。</p>
              </div>

              <div className="field-grid">
                <PasswordField
                  value={password}
                  onChange={updateAdminPassword}
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
                {isExtending ? "延长中..." : "延长链接有效期"}
              </button>

              {extendError ? <p className="message error" role="alert">{extendError}</p> : null}
              {extendStatus ? <p className="message success" role="status">{extendStatus}</p> : null}
            </form>
          ) : (
            <form className="tool-form" onSubmit={invalidateExistingLink}>
              <div className="form-title">
                <span className="panel-eyebrow" aria-hidden="true">Close access</span>
                <h2 id="tool-title">失效已有链接</h2>
                <p>失效后，该链接再次访问会返回 410，不再暴露 YAML 内容。</p>
              </div>

              <PasswordField
                value={password}
                onChange={updateAdminPassword}
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

              {invalidateError ? <p className="message error" role="alert">{invalidateError}</p> : null}
              {invalidateStatus ? <p className="message success" role="status">{invalidateStatus}</p> : null}
            </form>
          )}
          </> : null}
        </section>
      </dialog>

      <footer className="app-footer"><span>请妥善保管管理员密码和 LINK_SECRET</span><span className="brand-credit">Design by Brclio · v0.1.0</span></footer>
    </main>
  );
}

function getStoredLinkStatus(link: GeneratedLink, now: number): Exclude<HistoryFilter, "all"> {
  if (link.invalidatedAt) return "invalidated";
  return Date.parse(link.expiresAt) <= now ? "expired" : "active";
}

function getSubscriptionHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "订阅链接";
  }
}

function ActionIcon({ kind }: { kind: "search" | "plus" | "lock" | "refresh" | "chevron" | "link" | "external" | "list" | "close" }) {
  const paths = {
    search: "M21 21l-5-5m2-6a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    plus: "M12 5v14M5 12h14",
    lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
    refresh: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1",
    chevron: "m7 10 5 5 5-5",
    link: "m10 14 4-4m-5-3 1-1a4.25 4.25 0 0 1 6 6l-1 1m-6-2-1 1a4.25 4.25 0 0 0 6 6l1-1",
    external: "M14 5h5v5m-9 4 9-9M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4",
    list: "M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1",
    close: "m6 6 12 12M18 6 6 18"
  };
  return <svg className="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
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
    return `链接已过期 ${formatDuration(Math.abs(data.expiresInSeconds || 0))}，可延长有效期`;
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
    source: link.source,
    urls: link.urls
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
    "source",
    "urls"
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
      record.source,
      record.urls?.join("\n")
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
      `来源：${record.source ?? ""}`,
      `其它原始地址：${record.urls?.filter((url) => url !== record.url).join(" / ") ?? ""}`
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
    createdAt: data.createdAt || new Date().toISOString(),
    previousExpiresAt: data.previousExpiresAt,
    wasExpired: data.wasExpired,
    source: options.source,
    urls: data.urls
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
    (link.source === undefined || link.source === "created" || link.source === "extended") &&
    (link.urls === undefined || (Array.isArray(link.urls) && link.urls.every((url) => typeof url === "string" && url.length > 0)))
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

    linksByToken.set(link.token, {
      ...existing,
      invalidatedAt: existing.invalidatedAt || link.invalidatedAt,
      urls: getOriginalUrls(existing, link)
    });
  }

  const merged = Array.from(linksByToken.values()).sort((left, right) => {
    const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
    return createdAtOrder || right.token.localeCompare(left.token);
  });

  return areGeneratedLinkListsEqual(merged, current) ? current : merged;
}

function mergeCloudGeneratedLinks(current: GeneratedLink[], incoming: GeneratedLink[]): GeneratedLink[] {
  const currentByToken = new Map(current.map((link) => [link.token, link]));
  const incomingByToken = new Map(incoming.map((link) => [link.token, link]));
  const merged = current.map((local) => {
    const cloud = incomingByToken.get(local.token);

    if (!cloud) {
      return local;
    }

    return {
      ...cloud,
      url: local.url,
      urls: getOriginalUrls(local, cloud),
      invalidatedAt: cloud.invalidatedAt || local.invalidatedAt
    };
  });

  for (const cloud of incoming) {
    if (!currentByToken.has(cloud.token)) {
      merged.push(cloud);
    }
  }

  const result = mergeGeneratedLinks([], merged);
  return areGeneratedLinkListsEqual(result, current) ? current : result;
}

function getOriginalUrls(...links: GeneratedLink[]): string[] {
  return Array.from(new Set(links.flatMap((link) => [link.url, ...(link.urls || [])])));
}

function getCloudLinks(data: SubscriptionsResponse): GeneratedLink[] {
  if (!Array.isArray(data.links) || !data.links.every(isGeneratedLink)) {
    throw new Error("GitHub 返回的订阅数据格式不完整");
  }

  return data.links;
}

function getAutomaticSyncLabel(state: AutomaticSyncState, configured: boolean | null): string {
  switch (state.phase) {
    case "idle":
      return "等待管理员密码";
    case "waiting":
      return "等待连接";
    case "refreshing":
      return state.lastSyncedAt === null ? "正在连接" : "正在同步";
    case "connected":
      return configured ? "已连接" : "存储待配置";
    case "paused":
      return "页面隐藏，已暂停";
    case "auth-error":
      return "认证失败，已暂停";
    case "error":
      return "读取失败";
  }
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
        link.source === other.source &&
        JSON.stringify(link.urls || []) === JSON.stringify(other.urls || [])
      );
    })
  );
}
