import Ajv, { type ErrorObject, type Schema } from "ajv";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Copy,
  Database,
  Download,
  GripVertical,
  Maximize2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { neon } from "@neondatabase/serverless";
import renderSchema from "../generated/shiplog/render.config.schema.json";
import {
  appendShiplogFooter,
  buildTargetRenderContext,
  renderTargetMarkdown,
  validateTargetRenderSql,
  type TargetRenderQueryRunner,
} from "../generated/shiplog/target_render";
import type {
  RenderQueryMode,
  TargetRenderBlock,
  TargetRenderConfig,
  TargetRenderQueryConfig,
  TargetRenderTableColumn,
} from "../generated/shiplog/types/config/render";
import {
  cloneRenderConfig,
  createBlock,
  createInitialRenderConfig,
  createQueryConfig,
  createQueryName,
  createTableColumn,
  formatRenderConfig,
  type ConnectionStatus,
  type StudioMode,
} from "../lib/render-studio-model";
import {
  getConfigBuilderDeviceBlockReason,
  readConfigBuilderDevice,
  type ConfigBuilderDeviceBlockReason,
} from "../lib/config-builder-device";
import { configBuilderNoAutofillProps } from "../lib/config-builder-autofill";
import {
  readStoredRenderStudioOutput,
  writeStoredRenderStudioOutput,
} from "../lib/render-studio-storage";
import { DeviceGate } from "./DeviceGate";
import { MarkdownPreview } from "./MarkdownPreview";

type NeonSql = {
  query: (sql: string) => Promise<unknown[]>;
};

type PreviewState = {
  status: "idle" | "rendering" | "ready" | "error";
  markdown: string;
  message: string;
  context: Record<string, unknown> | null;
};

type QueryTestMessage = {
  status: "idle" | "testing" | "ready" | "error";
  message: string;
};

type BlockPreviewState = {
  markdown: string;
  message: string;
};

type DatabaseProvider = "neon";
type ConnectionStep = "provider" | "connection";

const ajv = new Ajv({ allErrors: true, strict: false, useDefaults: true });
const validateRenderConfig = ajv.compile<TargetRenderConfig>(renderSchema as Schema);
const blockTypes: TargetRenderBlock["type"][] = [
  "heading",
  "paragraph",
  "table",
  "list",
  "repeat",
  "rawMarkdown",
  "divider",
];
const previewDisplayName = "Preview User";
const schemaDocsUrl = "https://github.com/karanbalani/shiplog/blob/main/docs/SCHEMA.md";

const rendorStudioDeviceGateCopy = {
  narrowTitle: "Widen this browser window",
  deviceTitle: "Use a laptop for Rendor Studio",
  narrowBody:
    "This looks like a desktop browser, but the current window is too narrow for the Rendor Studio layout. Make the window wider to continue.",
  deviceBody:
    "Rendor Studio needs enough room for SQL editing, schema browsing, JSON output, and live Markdown preview. Open it from a desktop browser where you can use your database credentials safely.",
};

function parseRenderConfig(value: unknown): TargetRenderConfig | null {
  const cloned = JSON.parse(JSON.stringify(value)) as unknown;
  return validateRenderConfig(cloned) ? (cloned as TargetRenderConfig) : null;
}

function validationMessage(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "Invalid render config.";
  return errors
    .slice(0, 3)
    .map((error) => `${error.instancePath || "render config"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function initialConfig(): TargetRenderConfig {
  if (typeof window === "undefined") return createInitialRenderConfig();

  return createInitialRenderConfig(
    readStoredRenderStudioOutput(window.localStorage, (value): value is TargetRenderConfig =>
      Boolean(parseRenderConfig(value)),
    ),
  );
}

function queryEntries(config: TargetRenderConfig): Array<[string, TargetRenderQueryConfig]> {
  return Object.entries(config.queries ?? {});
}

function blockLabel(block: TargetRenderBlock, index: number): string {
  if (block.type === "heading") return `Heading ${block.level}`;
  if (block.type === "paragraph") return "Paragraph";
  if (block.type === "table") return `Table ${block.query ? `(${block.query})` : ""}`.trim();
  if (block.type === "list") return `List ${block.query ? `(${block.query})` : ""}`.trim();
  if (block.type === "repeat") return `Repeat ${block.query ? `(${block.query})` : ""}`.trim();
  if (block.type === "rawMarkdown") return "Raw Markdown";
  return `Divider ${index + 1}`;
}

function isQueryBackedBlock(
  block: TargetRenderBlock,
): block is Extract<TargetRenderBlock, { query: string }> {
  return block.type === "table" || block.type === "list" || block.type === "repeat";
}

function blockPreviewState(
  block: TargetRenderBlock,
  context: Record<string, unknown> | null,
): BlockPreviewState {
  const previewContext = context ?? { profile: { displayName: previewDisplayName } };

  if (isQueryBackedBlock(block) && !Array.isArray(previewContext[block.query])) {
    return {
      markdown: "",
      message: "Connect and render preview to see this data block.",
    };
  }

  try {
    const markdown = renderTargetMarkdown([block], previewContext).trim();
    return {
      markdown,
      message: markdown ? "" : "This block is empty.",
    };
  } catch (error) {
    return {
      markdown: "",
      message: error instanceof Error ? error.message : "Block preview unavailable.",
    };
  }
}

export default function RendorStudio() {
  const sqlRef = useRef<NeonSql | null>(null);
  const copiedTimeoutRef = useRef<number | null>(null);
  const [mode, setMode] = useState<StudioMode>("guided");
  const [config, setConfig] = useState<TargetRenderConfig>(() => initialConfig());
  const [jsonText, setJsonText] = useState(() => formatRenderConfig(initialConfig()));
  const [jsonError, setJsonError] = useState("");
  const [databaseProvider, setDatabaseProvider] = useState<DatabaseProvider | null>(null);
  const [connectionStep, setConnectionStep] = useState<ConnectionStep>("provider");
  const [connectionString, setConnectionString] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState("Connect Neon to start.");
  const [connectionFieldError, setConnectionFieldError] = useState("");
  const [studioBlockReason, setStudioBlockReason] = useState<ConfigBuilderDeviceBlockReason | null>(
    null,
  );
  const [hasStarted, setHasStarted] = useState(false);
  const [draggedBlockIndex, setDraggedBlockIndex] = useState<number | null>(null);
  const [queryTestMessages, setQueryTestMessages] = useState<Record<number, QueryTestMessage>>({});
  const [pendingNavigationHref, setPendingNavigationHref] = useState<string | null>(null);
  const [copiedAction, setCopiedAction] = useState<string | null>(null);
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({
    status: "idle",
    markdown: "",
    message: "Connect Neon to run live preview.",
    context: null,
  });

  const renderedJson = useMemo(() => formatRenderConfig(config), [config]);
  const queryNames = useMemo(() => queryEntries(config).map(([name]) => name), [config]);
  const manyQueryNames = useMemo(
    () =>
      queryEntries(config)
        .filter(([, query]) => query.mode === "many")
        .map(([name]) => name),
    [config],
  );

  useEffect(() => {
    function syncDeviceState() {
      setStudioBlockReason(getConfigBuilderDeviceBlockReason(readConfigBuilderDevice()));
    }

    syncDeviceState();
    window.addEventListener("resize", syncDeviceState);
    return () => window.removeEventListener("resize", syncDeviceState);
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasStarted) return;

    function guardHeaderNavigation(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>(".site-header a");
      if (!anchor?.href) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.href === currentUrl.href) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      setPendingNavigationHref(nextUrl.href);
    }

    document.addEventListener("click", guardHeaderNavigation, true);
    return () => document.removeEventListener("click", guardHeaderNavigation, true);
  }, [hasStarted]);

  useEffect(() => {
    setJsonText(renderedJson);
  }, [renderedJson]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const timeout = window.setTimeout(() => {
      const validConfig = parseRenderConfig(config);
      if (validConfig) writeStoredRenderStudioOutput(window.localStorage, validConfig);
    }, 420);

    return () => window.clearTimeout(timeout);
  }, [config]);

  useEffect(() => {
    if (!hasStarted || !sqlRef.current) return;

    const interval = window.setInterval(() => {
      void healthCheck();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [hasStarted]);

  useEffect(() => {
    if (!hasStarted || connectionStatus !== "connected" || !sqlRef.current) {
      if (hasStarted && connectionStatus !== "connected") {
        setPreview({
          status: "idle",
          markdown: "",
          message: "Reconnect Neon to resume live preview.",
          context: null,
        });
      }
      return;
    }

    let cancelled = false;
    setPreview((current) => ({ ...current, status: "rendering", message: "Rendering preview..." }));

    const timeout = window.setTimeout(() => {
      const queryRunner: TargetRenderQueryRunner = async (sqlText) => {
        const sql = sqlRef.current;
        if (!sql) throw new Error("Neon is not connected.");
        validateTargetRenderSql(sqlText, "preview");
        return (await sql.query(sqlText)) as Record<string, unknown>[];
      };

      buildTargetRenderContext({
        config,
        profile: { displayName: previewDisplayName },
        queryRunner,
      })
        .then((context) => {
          if (cancelled) return;
          setPreview({
            status: "ready",
            markdown: appendShiplogFooter(`${renderTargetMarkdown(config.markdown, context)}\n`),
            message: "Preview ready.",
            context,
          });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setPreview({
            status: "error",
            markdown: "",
            message: error instanceof Error ? error.message : String(error),
            context: null,
          });
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [config, connectionStatus, hasStarted]);

  async function testConnection() {
    const trimmedConnectionString = connectionString.trim();
    if (!trimmedConnectionString) {
      sqlRef.current = null;
      setConnectionStatus("idle");
      setConnectionFieldError("Connection string is required.");
      setConnectionMessage("");
      return;
    }

    setConnectionFieldError("");
    setConnectionStatus("testing");
    setConnectionMessage("");

    try {
      const sql = neon(trimmedConnectionString) as NeonSql;
      await sql.query("SELECT 1 AS ok");
      sqlRef.current = sql;
      setConnectionStatus("connected");
      setConnectionMessage("Connection ready.");
    } catch (error) {
      sqlRef.current = null;
      setConnectionStatus("error");
      setConnectionMessage(error instanceof Error ? error.message : "Connection failed.");
    }
  }

  async function healthCheck() {
    const sql = sqlRef.current;
    if (!sql) return;

    try {
      await sql.query("SELECT 1 AS ok");
      setConnectionStatus("connected");
      setConnectionMessage("Connection ready.");
    } catch (error) {
      setConnectionStatus("stale");
      setConnectionMessage(error instanceof Error ? error.message : "Connection check failed.");
    }
  }

  function updateConnectionString(value: string) {
    setConnectionString(value);
    if (value.trim()) setConnectionFieldError("");

    if (
      connectionStatus === "connected" ||
      connectionStatus === "error" ||
      connectionStatus === "stale"
    ) {
      sqlRef.current = null;
      setConnectionStatus("idle");
      setConnectionMessage("Test Neon connection.");
    }
  }

  function handleConnectionKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;

    event.preventDefault();
    if (connectionStatus === "connected" || connectionStatus === "testing") return;
    void testConnection();
  }

  function updateConfig(next: TargetRenderConfig) {
    setConfig(cloneRenderConfig(next));
    setJsonError("");
  }

  function removeQueryIfUnused(
    queries: Record<string, TargetRenderQueryConfig>,
    markdown: TargetRenderBlock[],
    queryName: string,
  ) {
    if (!queryName) return queries;
    if (
      markdown.some(
        (block) =>
          (isQueryBackedBlock(block) && block.query === queryName) ||
          block.visibleWhen?.query === queryName,
      )
    ) {
      return queries;
    }

    const nextQueries = { ...queries };
    delete nextQueries[queryName];
    return nextQueries;
  }

  function createDataBlock(
    type: "table" | "list" | "repeat",
    existingNames = queryNames,
  ): TargetRenderBlock {
    const block = createBlock(type);
    if (!isQueryBackedBlock(block)) return block;
    return { ...block, query: createQueryName(existingNames) };
  }

  function updateBlock(index: number, block: TargetRenderBlock) {
    updateConfig({
      ...config,
      markdown: config.markdown.map((item, itemIndex) => (itemIndex === index ? block : item)),
    });
  }

  function updateBlockType(index: number, type: TargetRenderBlock["type"]) {
    const currentBlock = config.markdown[index];
    if (!currentBlock) return;

    const previousQueryName = isQueryBackedBlock(currentBlock) ? currentBlock.query : "";
    const nextBlock =
      type === "table" || type === "list" || type === "repeat"
        ? createDataBlock(type)
        : createBlock(type);
    const nextMarkdown = config.markdown.map((block, blockIndex) =>
      blockIndex === index ? nextBlock : block,
    );
    let nextQueries = { ...config.queries };

    if (isQueryBackedBlock(nextBlock)) {
      nextQueries[nextBlock.query] = createQueryConfig();
    }

    if (previousQueryName) {
      nextQueries = removeQueryIfUnused(nextQueries, nextMarkdown, previousQueryName);
    }

    updateConfig({ ...config, queries: nextQueries, markdown: nextMarkdown });
  }

  function updateBlockQuery(index: number, patch: Partial<TargetRenderQueryConfig>) {
    const block = config.markdown[index];
    if (!block || !isQueryBackedBlock(block)) return;

    const queries = { ...config.queries };
    let queryName = block.query;
    let markdown = config.markdown;

    if (!queryName || !queries[queryName]) {
      queryName = createQueryName(Object.keys(queries));
      queries[queryName] = createQueryConfig();
      markdown = config.markdown.map((item, itemIndex) =>
        itemIndex === index ? { ...block, query: queryName } : item,
      );
    }

    queries[queryName] = { ...queries[queryName], ...patch };
    updateConfig({ ...config, queries, markdown });
  }

  function addBlock() {
    updateConfig({ ...config, markdown: [...config.markdown, createBlock("paragraph")] });
  }

  function removeBlock(index: number) {
    const removedBlock = config.markdown[index];
    const markdown = config.markdown.filter((_, itemIndex) => itemIndex !== index);
    const safeMarkdown = markdown.length ? markdown : [createBlock("paragraph")];
    const queries =
      removedBlock && isQueryBackedBlock(removedBlock)
        ? removeQueryIfUnused({ ...config.queries }, safeMarkdown, removedBlock.query)
        : config.queries;
    updateConfig({ ...config, queries, markdown: safeMarkdown });
  }

  function moveBlock(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= config.markdown.length ||
      toIndex >= config.markdown.length
    ) {
      return;
    }

    const markdown = [...config.markdown];
    const [block] = markdown.splice(fromIndex, 1);
    if (!block) return;
    markdown.splice(toIndex, 0, block);
    updateConfig({ ...config, markdown });
  }

  function handleBlockDragStart(index: number, event: DragEvent<HTMLButtonElement>) {
    setDraggedBlockIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));

    const dragPreview = event.currentTarget.closest<HTMLElement>(".studio-block-pair");
    if (!dragPreview) return;

    const previewBounds = dragPreview.getBoundingClientRect();
    event.dataTransfer.setDragImage(
      dragPreview,
      event.clientX - previewBounds.left,
      event.clientY - previewBounds.top,
    );
  }

  function handleBlockDrop(index: number, event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const fromIndex = draggedBlockIndex ?? Number(event.dataTransfer.getData("text/plain"));
    setDraggedBlockIndex(null);
    if (Number.isNaN(fromIndex)) return;
    moveBlock(fromIndex, index);
  }

  async function testBlockQuery(index: number) {
    const block = config.markdown[index];
    if (!block || !isQueryBackedBlock(block)) return;

    const query = config.queries?.[block.query];
    const sql = sqlRef.current;
    if (!sql || connectionStatus !== "connected") {
      setQueryTestMessages((current) => ({
        ...current,
        [index]: { status: "error", message: "Connect Neon before testing this query." },
      }));
      return;
    }

    if (!query?.sql.trim()) {
      setQueryTestMessages((current) => ({
        ...current,
        [index]: { status: "error", message: "Write SQL before testing this block." },
      }));
      return;
    }

    setQueryTestMessages((current) => ({
      ...current,
      [index]: { status: "testing", message: "Testing query..." },
    }));

    try {
      validateTargetRenderSql(query.sql, `block ${index + 1}`);
      const rows = await sql.query(query.sql);
      setQueryTestMessages((current) => ({
        ...current,
        [index]: {
          status: "ready",
          message: `Query returned ${rows.length} ${rows.length === 1 ? "row" : "rows"}.`,
        },
      }));
    } catch (error) {
      setQueryTestMessages((current) => ({
        ...current,
        [index]: {
          status: "error",
          message: error instanceof Error ? error.message : "Query failed.",
        },
      }));
    }
  }

  function applyJsonText(value: string) {
    setJsonText(value);

    try {
      const parsed = JSON.parse(value) as unknown;
      const next = parseRenderConfig(parsed);
      if (!next) {
        setJsonError(validationMessage(validateRenderConfig.errors));
        return;
      }
      updateConfig(next);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Invalid JSON.");
    }
  }

  function showCopiedAction(label: string) {
    if (copiedTimeoutRef.current !== null) {
      window.clearTimeout(copiedTimeoutRef.current);
    }

    setCopiedAction(label);
    copiedTimeoutRef.current = window.setTimeout(() => {
      setCopiedAction(null);
      copiedTimeoutRef.current = null;
    }, 1600);
  }

  async function copyText(value: string, label?: string) {
    if (label) showCopiedAction(label);

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // The UI still acknowledges the click; browser clipboard permission can vary by context.
    }
  }

  function downloadJson() {
    const blob = new Blob([renderedJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "render.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function resetOutput() {
    updateConfig(createInitialRenderConfig(null));
  }

  function chooseProvider(provider: DatabaseProvider) {
    setDatabaseProvider(provider);
    setConnectionStep("connection");
    setConnectionMessage("Connect Neon to start.");
  }

  const readyToStart = connectionStatus === "connected";
  const canTestConnection = connectionStatus !== "testing" && connectionStatus !== "connected";
  const connectionTestButtonClassName = [
    "tool-button",
    "connection-test-button",
    connectionStatus === "connected" ? "is-verified" : "",
    connectionStatus === "testing" ? "is-testing" : "",
    connectionStatus === "error" || connectionStatus === "stale" ? "is-error" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const connectionTestButtonText =
    connectionStatus === "connected"
      ? "Connection ready"
      : connectionStatus === "testing"
        ? "Testing connection"
        : "Test connection";
  const connectionIsLocked = connectionStatus === "connected";
  const connectionInputClassName = [
    "connection-string-input",
    connectionFieldError ? "is-error" : "",
    connectionIsLocked ? "is-locked" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const showConnectionStatus = connectionStatus === "error" || connectionStatus === "stale";
  const studioDeviceGateClassName = [
    "builder-device-fallback",
    studioBlockReason ? "is-runtime-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="studio-shell">
      <DeviceGate
        className={studioDeviceGateClassName}
        copy={rendorStudioDeviceGateCopy}
        reason={studioBlockReason ?? undefined}
      />
      {!studioBlockReason && (
        <>
          {!hasStarted && (
            <div className="studio-onboarding" role="presentation">
              <dialog open className="studio-modal" aria-labelledby="connection-title">
                {connectionStep === "provider" ? (
                  <>
                    <div className="studio-modal-header">
                      <div className="studio-modal-title-copy">
                        <p className="studio-modal-eyebrow">Database provider</p>
                        <h2 id="connection-title">Choose database provider</h2>
                        <p>
                          Rendor Studio runs fully in your browser and needs a browser-safe database
                          provider for live preview.
                        </p>
                      </div>
                    </div>
                    <button
                      className="provider-card provider-option"
                      type="button"
                      aria-label="Select Neon Postgres"
                      aria-pressed={databaseProvider === "neon"}
                      onClick={() => chooseProvider("neon")}
                    >
                      <img
                        className="provider-logo"
                        src="/brand/neon-logomark-light-color.svg"
                        alt=""
                        aria-hidden="true"
                        width="18"
                        height="18"
                      />
                      <div>
                        <strong>Neon Postgres</strong>
                      </div>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="studio-modal-header">
                      <div className="studio-modal-title-copy">
                        <p className="studio-modal-eyebrow">Connection setup</p>
                        <h2 id="connection-title">Connect Neon Postgres</h2>
                        <p>
                          Use a read-only Neon role when possible; the connection string is never
                          saved.
                        </p>
                      </div>
                    </div>
                    <label className="studio-field">
                      <span>Connection string</span>
                      <input
                        {...configBuilderNoAutofillProps}
                        aria-invalid={connectionFieldError ? "true" : undefined}
                        aria-readonly={connectionIsLocked ? "true" : undefined}
                        className={connectionInputClassName}
                        readOnly={connectionIsLocked}
                        value={connectionString}
                        placeholder="postgresql://user:password@host/db?sslmode=require"
                        onChange={(event) => updateConnectionString(event.target.value)}
                        onKeyDown={handleConnectionKeyDown}
                      />
                    </label>
                    {connectionFieldError && (
                      <p className="studio-field-error">{connectionFieldError}</p>
                    )}
                    {showConnectionStatus && (
                      <p className={`studio-status is-${connectionStatus}`}>{connectionMessage}</p>
                    )}
                    <div className="studio-modal-actions studio-connection-actions">
                      <button
                        className="tool-button studio-modal-back-button"
                        type="button"
                        aria-label="Go back"
                        title="Go back"
                        onClick={() => setConnectionStep("provider")}
                      >
                        <ArrowLeft size={15} aria-hidden="true" />
                        Go back
                      </button>
                      <div className="studio-modal-primary-actions">
                        <button
                          className={connectionTestButtonClassName}
                          type="button"
                          disabled={!canTestConnection}
                          onClick={() => void testConnection()}
                        >
                          {connectionStatus === "connected" ? (
                            <CheckCircle2 size={16} aria-hidden="true" />
                          ) : (
                            <RefreshCw size={16} aria-hidden="true" />
                          )}
                          {connectionTestButtonText}
                        </button>
                        <button
                          className="button button-primary"
                          type="button"
                          disabled={!readyToStart}
                          onClick={() => setHasStarted(true)}
                        >
                          Start building
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </dialog>
            </div>
          )}

          {hasStarted && (
            <div className="studio-layout builder-shell-interactive">
              <div className="studio-panel studio-author">
                <div className="studio-panel-heading studio-author-heading">
                  <div className="studio-title-copy">
                    <div className="studio-title-row">
                      <h2>Rendor Studio</h2>
                      <span
                        className={`studio-connection-beacon is-${connectionStatus}`}
                        aria-label={`Database connection ${
                          connectionStatus === "connected" ? "connected" : "needs reconnect"
                        }`}
                      >
                        <span className="studio-connection-beacon-dot" aria-hidden="true" />
                        {connectionStatus === "connected" ? "Connected" : "Reconnect"}
                      </span>
                    </div>
                    <p>
                      Create <code>.shiplog/render.json</code> with live Neon-backed preview.
                    </p>
                  </div>
                  <div className="studio-toolbar-actions">
                    <div className="studio-actions">
                      <a
                        className="tool-button"
                        href={schemaDocsUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <BookOpen size={16} aria-hidden="true" />
                        Schema docs
                      </a>
                      <button
                        className={`tool-button ${copiedAction === "json" ? "is-copied" : ""}`}
                        type="button"
                        onClick={() => void copyText(renderedJson, "json")}
                      >
                        {copiedAction === "json" ? (
                          <CheckCircle2 size={16} aria-hidden="true" />
                        ) : (
                          <Copy size={16} aria-hidden="true" />
                        )}
                        {copiedAction === "json" ? "Copied" : "Copy JSON"}
                      </button>
                      <button className="tool-button" type="button" onClick={downloadJson}>
                        <Download size={16} aria-hidden="true" />
                        Download
                      </button>
                      <button className="tool-button" type="button" onClick={resetOutput}>
                        <RefreshCw size={16} aria-hidden="true" />
                        Reset
                      </button>
                    </div>
                  </div>
                </div>

                <div className="studio-tabs" role="tablist" aria-label="Rendor authoring modes">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "guided"}
                    onClick={() => setMode("guided")}
                  >
                    Guided
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === "json"}
                    onClick={() => setMode("json")}
                  >
                    JSON
                  </button>
                </div>

                {mode === "guided" ? (
                  <div className="studio-editor-scroll">
                    <section className="studio-section">
                      <div className="studio-section-heading">
                        <h3>Markdown blocks</h3>
                        <button className="tool-button" type="button" onClick={addBlock}>
                          <Plus size={16} aria-hidden="true" />
                          Add block
                        </button>
                      </div>
                      <div className="studio-stack">
                        {config.markdown.map((block, index) => (
                          <div
                            key={`${block.type}-${index}`}
                            className={`studio-block-pair ${
                              draggedBlockIndex === index ? "is-dragging" : ""
                            }`}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => handleBlockDrop(index, event)}
                          >
                            <BlockEditor
                              block={block}
                              dragged={draggedBlockIndex === index}
                              index={index}
                              query={
                                isQueryBackedBlock(block)
                                  ? config.queries?.[block.query]
                                  : undefined
                              }
                              visibilityQueryNames={manyQueryNames}
                              queryTestMessage={queryTestMessages[index]}
                              onChangeType={(type) => updateBlockType(index, type)}
                              onChange={(nextBlock) => updateBlock(index, nextBlock)}
                              onDragEnd={() => setDraggedBlockIndex(null)}
                              onDragStart={(event) => handleBlockDragStart(index, event)}
                              onQueryChange={(patch) => updateBlockQuery(index, patch)}
                              onRemove={removeBlock}
                              onTestQuery={() => void testBlockQuery(index)}
                            />
                            <BlockPreview preview={blockPreviewState(block, preview.context)} />
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="studio-json-pane">
                    <label className="studio-field studio-json-field">
                      <span>render.json</span>
                      <textarea
                        {...configBuilderNoAutofillProps}
                        value={jsonText}
                        rows={24}
                        onChange={(event) => applyJsonText(event.target.value)}
                      />
                    </label>
                    {jsonError && <p className="studio-error">{jsonError}</p>}
                  </div>
                )}
                <button
                  className="full-preview-floating-button"
                  type="button"
                  onClick={() => setFullPreviewOpen(true)}
                >
                  <Maximize2 size={16} aria-hidden="true" />
                  Full preview
                </button>
              </div>
            </div>
          )}
          {fullPreviewOpen && (
            <div className="studio-modal-backdrop full-preview-backdrop" role="presentation">
              <dialog
                open
                className="studio-modal full-preview-modal"
                aria-labelledby="full-preview-title"
              >
                <div className="studio-modal-header">
                  <div className="studio-modal-title-copy">
                    <p className="studio-modal-eyebrow">Rendered markdown</p>
                    <h2 id="full-preview-title">Full preview</h2>
                    <p>Final README output generated from the current render.json.</p>
                  </div>
                </div>
                <div className="full-preview-content">
                  {preview.markdown ? (
                    <MarkdownPreview markdown={preview.markdown} />
                  ) : (
                    <p
                      className={`studio-status is-${
                        preview.status === "error" ? "error" : preview.status
                      }`}
                    >
                      {preview.message}
                    </p>
                  )}
                </div>
                <div className="studio-modal-actions full-preview-actions">
                  <button
                    className="tool-button"
                    type="button"
                    onClick={() => setFullPreviewOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </dialog>
            </div>
          )}
          {pendingNavigationHref && (
            <div className="studio-modal-backdrop navigation-guard-backdrop" role="presentation">
              <dialog open className="studio-modal navigation-guard-modal">
                <div className="studio-modal-header">
                  <div className="studio-modal-title-copy">
                    <p className="studio-modal-eyebrow">Navigation</p>
                    <h2>Leave Rendor Studio?</h2>
                    <p>
                      Your render.json is saved locally, but leaving this page will close the
                      current Neon connection.
                    </p>
                  </div>
                </div>
                <div className="studio-modal-actions navigation-guard-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => setPendingNavigationHref(null)}
                  >
                    Stay editing
                  </button>
                  <button
                    className="tool-button"
                    type="button"
                    onClick={() => {
                      window.open(pendingNavigationHref, "_blank", "noopener,noreferrer");
                      setPendingNavigationHref(null);
                    }}
                  >
                    Open new tab
                  </button>
                  <button
                    className="tool-button"
                    type="button"
                    onClick={() => {
                      window.location.href = pendingNavigationHref;
                    }}
                  >
                    Leave page
                  </button>
                </div>
              </dialog>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function BlockEditor({
  block,
  dragged,
  index,
  query,
  queryTestMessage,
  visibilityQueryNames,
  onChange,
  onChangeType,
  onDragEnd,
  onDragStart,
  onQueryChange,
  onRemove,
  onTestQuery,
}: {
  block: TargetRenderBlock;
  dragged: boolean;
  index: number;
  query?: TargetRenderQueryConfig;
  queryTestMessage?: QueryTestMessage;
  visibilityQueryNames: string[];
  onChange: (block: TargetRenderBlock) => void;
  onChangeType: (type: TargetRenderBlock["type"]) => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onQueryChange: (patch: Partial<TargetRenderQueryConfig>) => void;
  onRemove: (index: number) => void;
  onTestQuery: () => void;
}) {
  return (
    <article className={`studio-card block-card ${dragged ? "is-dragging" : ""}`}>
      <div className="block-header">
        <div className="block-title-row">
          <button
            className="drag-handle"
            type="button"
            draggable
            aria-label={`Drag block ${index + 1}`}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
          >
            <GripVertical size={17} aria-hidden="true" />
          </button>
          <strong>{blockLabel(block, index)}</strong>
        </div>
        <div className="block-actions">
          <button
            className="icon-button danger-button"
            type="button"
            aria-label={`Remove block ${index + 1}`}
            onClick={() => onRemove(index)}
          >
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="block-editor-fields">
        <label className="studio-field">
          <span>Type</span>
          <select
            value={block.type}
            onChange={(event) => onChangeType(event.target.value as TargetRenderBlock["type"])}
          >
            {blockTypes.map((type) => (
              <option value={type} key={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        {block.type === "heading" && (
          <div className="query-grid two-columns">
            <label className="studio-field">
              <span>Level</span>
              <select
                value={block.level}
                onChange={(event) =>
                  onChange({
                    ...block,
                    level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6,
                  })
                }
              >
                {[1, 2, 3, 4, 5, 6].map((level) => (
                  <option value={level} key={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-field">
              <span>Text</span>
              <input
                {...configBuilderNoAutofillProps}
                value={block.text}
                onChange={(event) => onChange({ ...block, text: event.target.value })}
              />
            </label>
          </div>
        )}

        {block.type === "paragraph" && (
          <label className="studio-field">
            <span>Text</span>
            <textarea
              {...configBuilderNoAutofillProps}
              value={block.text}
              rows={3}
              onChange={(event) => onChange({ ...block, text: event.target.value })}
            />
          </label>
        )}

        {block.type === "rawMarkdown" && (
          <label className="studio-field">
            <span>Content</span>
            <textarea
              {...configBuilderNoAutofillProps}
              value={block.content}
              rows={4}
              onChange={(event) => onChange({ ...block, content: event.target.value })}
            />
          </label>
        )}

        {block.type === "list" && (
          <>
            <BlockQueryEditor
              query={query}
              queryTestMessage={queryTestMessage}
              onQueryChange={onQueryChange}
              onTestQuery={onTestQuery}
            />
            <label className="studio-field">
              <span>Value template</span>
              <input
                {...configBuilderNoAutofillProps}
                value={block.value}
                onChange={(event) => onChange({ ...block, value: event.target.value })}
              />
            </label>
          </>
        )}

        {block.type === "repeat" && (
          <>
            <BlockQueryEditor
              query={query}
              queryTestMessage={queryTestMessage}
              onQueryChange={onQueryChange}
              onTestQuery={onTestQuery}
            />
            <label className="studio-field">
              <span>Template</span>
              <textarea
                {...configBuilderNoAutofillProps}
                value={block.template}
                rows={3}
                onChange={(event) => onChange({ ...block, template: event.target.value })}
              />
            </label>
            <label className="studio-field">
              <span>Separator</span>
              <input
                {...configBuilderNoAutofillProps}
                value={block.separator ?? ""}
                placeholder="newline by default"
                onChange={(event) =>
                  onChange({
                    ...block,
                    separator: event.target.value ? event.target.value : undefined,
                  })
                }
              />
            </label>
          </>
        )}

        {block.type === "table" && (
          <>
            <BlockQueryEditor
              query={query}
              queryTestMessage={queryTestMessage}
              onQueryChange={onQueryChange}
              onTestQuery={onTestQuery}
            />
            <div className="table-column-stack">
              <div className="studio-section-heading compact-heading">
                <h4>Columns</h4>
                <button
                  className="tool-button"
                  type="button"
                  onClick={() =>
                    onChange({ ...block, columns: [...block.columns, createTableColumn()] })
                  }
                >
                  <Plus size={15} aria-hidden="true" />
                  Add column
                </button>
              </div>
              {block.columns.map((column, columnIndex) => (
                <div className="query-grid column-grid" key={columnIndex}>
                  <label className="studio-field">
                    <span>Label</span>
                    <input
                      {...configBuilderNoAutofillProps}
                      value={column.label}
                      onChange={(event) =>
                        onChange({
                          ...block,
                          columns: updateColumn(block.columns, columnIndex, {
                            ...column,
                            label: event.target.value,
                          }),
                        })
                      }
                    />
                  </label>
                  <label className="studio-field">
                    <span>Value</span>
                    <input
                      {...configBuilderNoAutofillProps}
                      value={column.value}
                      onChange={(event) =>
                        onChange({
                          ...block,
                          columns: updateColumn(block.columns, columnIndex, {
                            ...column,
                            value: event.target.value,
                          }),
                        })
                      }
                    />
                  </label>
                  <button
                    className="icon-button danger-button"
                    type="button"
                    aria-label={`Remove column ${columnIndex + 1}`}
                    onClick={() =>
                      onChange({
                        ...block,
                        columns:
                          block.columns.length > 1
                            ? block.columns.filter((_, index) => index !== columnIndex)
                            : block.columns,
                      })
                    }
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <BlockVisibilityEditor
          block={block}
          queryNames={visibilityQueryNames}
          onChange={onChange}
        />
      </div>
    </article>
  );
}

function BlockVisibilityEditor({
  block,
  queryNames,
  onChange,
}: {
  block: TargetRenderBlock;
  queryNames: string[];
  onChange: (block: TargetRenderBlock) => void;
}) {
  const enabled = Boolean(block.visibleWhen);
  const selectedQuery = block.visibleWhen?.query ?? queryNames[0] ?? "";
  const selectOptions = selectedQuery
    ? Array.from(new Set([selectedQuery, ...queryNames]))
    : queryNames;

  return (
    <section className="block-query-panel">
      <label className="studio-field inline-field">
        <span>Conditional visibility</span>
        <input
          type="checkbox"
          aria-label="Enable conditional visibility"
          checked={enabled}
          disabled={!enabled && queryNames.length === 0}
          onChange={(event) =>
            onChange({
              ...block,
              visibleWhen: event.target.checked
                ? { query: selectedQuery, hasRows: true }
                : undefined,
            })
          }
        />
      </label>
      {enabled && (
        <div className="query-grid two-columns">
          <label className="studio-field">
            <span>Query</span>
            <select
              value={selectedQuery}
              onChange={(event) =>
                onChange({
                  ...block,
                  visibleWhen: {
                    query: event.target.value,
                    hasRows: block.visibleWhen?.hasRows ?? true,
                  },
                })
              }
            >
              {selectOptions.map((queryName) => (
                <option value={queryName} key={queryName}>
                  {queryName}
                </option>
              ))}
            </select>
          </label>
          <label className="studio-field">
            <span>Show block</span>
            <select
              value={block.visibleWhen?.hasRows ? "hasRows" : "empty"}
              onChange={(event) =>
                onChange({
                  ...block,
                  visibleWhen: {
                    query: selectedQuery,
                    hasRows: event.target.value === "hasRows",
                  },
                })
              }
            >
              <option value="hasRows">when query has rows</option>
              <option value="empty">when query is empty</option>
            </select>
          </label>
        </div>
      )}
    </section>
  );
}

function BlockPreview({ preview }: { preview: BlockPreviewState }) {
  return (
    <aside className="block-preview-panel" aria-label="Block preview">
      <span>Preview</span>
      {preview.markdown ? (
        <MarkdownPreview markdown={preview.markdown} />
      ) : (
        <p className="block-preview-note">{preview.message}</p>
      )}
    </aside>
  );
}

function BlockQueryEditor({
  query,
  queryTestMessage,
  onQueryChange,
  onTestQuery,
}: {
  query?: TargetRenderQueryConfig;
  queryTestMessage?: QueryTestMessage;
  onQueryChange: (patch: Partial<TargetRenderQueryConfig>) => void;
  onTestQuery: () => void;
}) {
  return (
    <section className="block-query-panel">
      <div className="studio-section-heading compact-heading">
        <h4>Data query</h4>
        <button className="tool-button" type="button" onClick={onTestQuery}>
          <Database size={15} aria-hidden="true" />
          Test query
        </button>
      </div>
      <div className="query-grid two-columns">
        <label className="studio-field">
          <span>Mode</span>
          <select
            value={query?.mode ?? "many"}
            onChange={(event) => onQueryChange({ mode: event.target.value as RenderQueryMode })}
          >
            <option value="many">many</option>
            <option value="one">one</option>
          </select>
        </label>
        <label className="studio-field">
          <span>SQL</span>
          <textarea
            {...configBuilderNoAutofillProps}
            value={query?.sql ?? ""}
            rows={7}
            onChange={(event) => onQueryChange({ sql: event.target.value })}
          />
        </label>
      </div>
      {queryTestMessage && (
        <p className={`query-test-message is-${queryTestMessage.status}`}>
          {queryTestMessage.message}
        </p>
      )}
    </section>
  );
}

function updateColumn(
  columns: TargetRenderTableColumn[],
  index: number,
  column: TargetRenderTableColumn,
) {
  return columns.map((item, itemIndex) => (itemIndex === index ? column : item));
}
