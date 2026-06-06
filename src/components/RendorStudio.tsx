import Ajv, { type ErrorObject, type Schema } from "ajv";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { neon } from "@neondatabase/serverless";
import renderSchema from "../generated/shiplog/render.config.schema.json";
import {
  renderTargetConfigWithRunner,
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
  normalizeSchemaTables,
  type ConnectionStatus,
  type SchemaColumn,
  type SchemaTable,
  type StudioMode,
} from "../lib/render-studio-model";
import {
  getConfigBuilderDeviceBlockReason,
  readConfigBuilderDevice,
  type ConfigBuilderDeviceBlockReason,
} from "../lib/config-builder-device";
import { configBuilderNoAutofillProps } from "../lib/config-builder-autofill";
import {
  encodeRenderStudioOutput,
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
};

type SchemaRow = {
  table_schema: string;
  table_name: string;
  table_type: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
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
  "rawMarkdown",
  "divider",
];

const rendorStudioDeviceGateCopy = {
  narrowTitle: "Widen this browser window",
  deviceTitle: "Use a laptop for Rendor Studio",
  narrowBody:
    "This looks like a desktop browser, but the current window is too narrow for the Rendor Studio layout. Make the window wider to continue.",
  deviceBody:
    "Rendor Studio needs enough room for SQL editing, schema browsing, JSON output, and live Markdown preview. Open it from a desktop browser where you can use your database credentials safely.",
};

const schemaSql = `
  SELECT
    c.table_schema,
    c.table_name,
    CASE WHEN t.table_type = 'VIEW' THEN 'view' ELSE 'table' END AS table_type,
    c.column_name,
    c.data_type,
    c.is_nullable
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema
   AND t.table_name = c.table_name
  WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY c.table_schema, c.table_name, c.ordinal_position
`;

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
  if (block.type === "rawMarkdown") return "Raw Markdown";
  return `Divider ${index + 1}`;
}

function isListLikeBlock(
  block: TargetRenderBlock,
): block is Extract<TargetRenderBlock, { query: string }> {
  return block.type === "table" || block.type === "list";
}

function tableRows(rows: SchemaRow[]): SchemaColumn[] {
  return rows.map((row) => ({
    schema: row.table_schema,
    table: row.table_name,
    type: row.table_type === "view" ? "view" : "table",
    name: row.column_name,
    dataType: row.data_type,
    nullable: row.is_nullable === "YES",
  }));
}

export default function RendorStudio() {
  const sqlRef = useRef<NeonSql | null>(null);
  const [mode, setMode] = useState<StudioMode>("guided");
  const [config, setConfig] = useState<TargetRenderConfig>(() => initialConfig());
  const [jsonText, setJsonText] = useState(() => formatRenderConfig(initialConfig()));
  const [jsonError, setJsonError] = useState("");
  const [databaseProvider, setDatabaseProvider] = useState<DatabaseProvider | null>(null);
  const [connectionStep, setConnectionStep] = useState<ConnectionStep>("provider");
  const [connectionString, setConnectionString] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState("Connect Neon to start.");
  const [studioBlockReason, setStudioBlockReason] = useState<ConfigBuilderDeviceBlockReason | null>(
    null,
  );
  const [hasStarted, setHasStarted] = useState(false);
  const [schemaTables, setSchemaTables] = useState<SchemaTable[]>([]);
  const [schemaQuery, setSchemaQuery] = useState("");
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaMessage, setSchemaMessage] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("Preview User");
  const [preview, setPreview] = useState<PreviewState>({
    status: "idle",
    markdown: "",
    message: "Connect Neon to run live preview.",
  });

  const renderedJson = useMemo(() => formatRenderConfig(config), [config]);
  const queryNames = useMemo(() => queryEntries(config).map(([name]) => name), [config]);
  const filteredSchemaTables = useMemo(() => {
    const needle = schemaQuery.trim().toLowerCase();
    if (!needle) return schemaTables;
    return schemaTables.filter((table) =>
      `${table.schema}.${table.name} ${table.columns.map((column) => column.name).join(" ")}`
        .toLowerCase()
        .includes(needle),
    );
  }, [schemaQuery, schemaTables]);

  useEffect(() => {
    function syncDeviceState() {
      setStudioBlockReason(getConfigBuilderDeviceBlockReason(readConfigBuilderDevice()));
    }

    syncDeviceState();
    window.addEventListener("resize", syncDeviceState);
    return () => window.removeEventListener("resize", syncDeviceState);
  }, []);

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

      renderTargetConfigWithRunner({
        config,
        profile: { displayName: profileDisplayName },
        queryRunner,
      })
        .then((markdown) => {
          if (cancelled) return;
          setPreview({ status: "ready", markdown, message: "Preview ready." });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setPreview({
            status: "error",
            markdown: "",
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [config, connectionStatus, hasStarted, profileDisplayName]);

  async function testConnection() {
    setConnectionStatus("testing");
    setConnectionMessage("Testing Neon connection...");

    try {
      const sql = neon(connectionString.trim()) as NeonSql;
      await sql.query("SELECT 1 AS ok");
      sqlRef.current = sql;
      setConnectionStatus("connected");
      setConnectionMessage("Connection ready.");
      await loadSchema(sql);
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

  async function loadSchema(sql: NeonSql) {
    setSchemaMessage("Loading schema...");
    try {
      const rows = (await sql.query(schemaSql)) as SchemaRow[];
      setSchemaTables(normalizeSchemaTables(tableRows(rows)));
      setSchemaMessage("Schema loaded.");
    } catch (error) {
      setSchemaTables([]);
      setSchemaMessage(error instanceof Error ? error.message : "Could not load schema.");
    }
  }

  function updateConfig(next: TargetRenderConfig) {
    setConfig(cloneRenderConfig(next));
    setJsonError("");
  }

  function updateQueries(queries: Record<string, TargetRenderQueryConfig>) {
    updateConfig({ ...config, queries });
  }

  function addQuery() {
    const name = createQueryName(queryNames);
    updateQueries({ ...config.queries, [name]: createQueryConfig() });
  }

  function renameQuery(previousName: string, nextName: string) {
    const normalized = nextName.trim().replace(/[^A-Za-z0-9_]+/g, "_");
    if (!normalized || normalized === previousName || (config.queries ?? {})[normalized]) return;

    const queries = { ...config.queries };
    const value = queries[previousName];
    delete queries[previousName];
    if (value) queries[normalized] = value;

    updateConfig({
      ...config,
      queries,
      markdown: config.markdown.map((block) =>
        isListLikeBlock(block) && block.query === previousName
          ? { ...block, query: normalized }
          : block,
      ),
    });
  }

  function updateQuery(name: string, patch: Partial<TargetRenderQueryConfig>) {
    const queries = { ...config.queries };
    const current = queries[name];
    if (!current) return;
    queries[name] = { ...current, ...patch };
    updateQueries(queries);
  }

  function removeQuery(name: string) {
    const queries = { ...config.queries };
    delete queries[name];
    updateQueries(queries);
  }

  function updateBlock(index: number, block: TargetRenderBlock) {
    updateConfig({
      ...config,
      markdown: config.markdown.map((item, itemIndex) => (itemIndex === index ? block : item)),
    });
  }

  function addBlock() {
    updateConfig({ ...config, markdown: [...config.markdown, createBlock("paragraph")] });
  }

  function removeBlock(index: number) {
    const markdown = config.markdown.filter((_, itemIndex) => itemIndex !== index);
    updateConfig({ ...config, markdown: markdown.length ? markdown : [createBlock("paragraph")] });
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= config.markdown.length) return;
    const markdown = [...config.markdown];
    const [block] = markdown.splice(index, 1);
    if (!block) return;
    markdown.splice(nextIndex, 0, block);
    updateConfig({ ...config, markdown });
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

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
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
  const hasConnectionString = connectionString.trim().length > 0;
  const canTestConnection = hasConnectionString && connectionStatus !== "testing";
  const connectionTestLabel =
    connectionStatus === "connected"
      ? "Connection verified"
      : connectionStatus === "testing"
        ? "Testing connection"
        : connectionStatus === "error" || connectionStatus === "stale"
          ? "Try again"
          : hasConnectionString
            ? "Test connection"
            : "Enter connection string";
  const connectionTestButtonClassName = [
    "tool-button",
    "connection-test-button",
    connectionStatus === "connected" ? "is-verified" : "",
    connectionStatus === "error" || connectionStatus === "stale" ? "is-error" : "",
  ]
    .filter(Boolean)
    .join(" ");
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
            <div className="studio-modal-backdrop" role="presentation">
              <dialog open className="studio-modal" aria-labelledby="connection-title">
                {connectionStep === "provider" ? (
                  <>
                    <div className="studio-modal-header">
                      <h2 id="connection-title">Choose database provider</h2>
                      <p>
                        Rendor Studio runs fully in your browser and needs a browser-safe database
                        provider for live preview.
                      </p>
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
                      <div className="studio-modal-title-row">
                        <button
                          className="icon-button studio-modal-back-button"
                          type="button"
                          aria-label="Back"
                          title="Back"
                          onClick={() => setConnectionStep("provider")}
                        >
                          <ArrowLeft size={15} aria-hidden="true" />
                        </button>
                        <h2 id="connection-title">Connect Neon Postgres</h2>
                      </div>
                      <p>
                        Use a read-only Neon role when possible; the connection string is never
                        saved.
                      </p>
                    </div>
                    <label className="studio-field">
                      <span>Connection string</span>
                      <input
                        {...configBuilderNoAutofillProps}
                        value={connectionString}
                        placeholder="postgresql://user:password@host/db?sslmode=require"
                        onChange={(event) => updateConnectionString(event.target.value)}
                      />
                    </label>
                    {(connectionStatus === "error" || connectionStatus === "stale") && (
                      <p className={`studio-status is-${connectionStatus}`}>{connectionMessage}</p>
                    )}
                    <div className="studio-modal-actions">
                      <button
                        className={connectionTestButtonClassName}
                        type="button"
                        disabled={!canTestConnection || connectionStatus === "connected"}
                        onClick={() => void testConnection()}
                      >
                        {connectionStatus === "connected" ? (
                          <CheckCircle2 size={16} aria-hidden="true" />
                        ) : (
                          <RefreshCw size={16} aria-hidden="true" />
                        )}
                        {connectionTestLabel}
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
                  </>
                )}
              </dialog>
            </div>
          )}

          <div className="studio-layout builder-shell-interactive" aria-hidden={!hasStarted}>
            <div className="studio-panel studio-author">
              <div className="studio-panel-heading">
                <div>
                  <h2>Rendor Studio</h2>
                  <p>Create `.shiplog/render.json` with live Neon-backed preview.</p>
                </div>
                <button className="tool-button" type="button" onClick={resetOutput}>
                  <RefreshCw size={16} aria-hidden="true" />
                  Reset output
                </button>
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
                <button className="schema-toggle" type="button" onClick={() => setSchemaOpen(true)}>
                  <Search size={15} aria-hidden="true" />
                  Schema
                </button>
              </div>

              {mode === "guided" ? (
                <div className="studio-editor-scroll">
                  <section className="studio-section">
                    <div className="studio-section-heading">
                      <h3>Queries</h3>
                      <button className="tool-button" type="button" onClick={addQuery}>
                        <Plus size={16} aria-hidden="true" />
                        Add query
                      </button>
                    </div>
                    <div className="studio-stack">
                      {queryEntries(config).map(([name, query]) => (
                        <article className="studio-card" key={name}>
                          <div className="query-grid">
                            <label className="studio-field">
                              <span>Name</span>
                              <input
                                {...configBuilderNoAutofillProps}
                                value={name}
                                onChange={(event) => renameQuery(name, event.target.value)}
                              />
                            </label>
                            <label className="studio-field">
                              <span>Mode</span>
                              <select
                                value={query.mode}
                                onChange={(event) =>
                                  updateQuery(name, { mode: event.target.value as RenderQueryMode })
                                }
                              >
                                <option value="many">many</option>
                                <option value="one">one</option>
                              </select>
                            </label>
                            <button
                              className="icon-button danger-button"
                              type="button"
                              aria-label={`Remove ${name}`}
                              onClick={() => removeQuery(name)}
                            >
                              <Trash2 size={17} aria-hidden="true" />
                            </button>
                          </div>
                          <label className="studio-field">
                            <span>SQL</span>
                            <textarea
                              {...configBuilderNoAutofillProps}
                              value={query.sql}
                              rows={6}
                              onChange={(event) => updateQuery(name, { sql: event.target.value })}
                            />
                          </label>
                        </article>
                      ))}
                    </div>
                  </section>

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
                        <BlockEditor
                          key={`${block.type}-${index}`}
                          block={block}
                          index={index}
                          queryNames={queryNames}
                          onChange={(nextBlock) => updateBlock(index, nextBlock)}
                          onMove={moveBlock}
                          onRemove={removeBlock}
                        />
                      ))}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="studio-json-pane">
                  <label className="studio-field">
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

              {schemaOpen && (
                <SchemaDrawer
                  message={schemaMessage}
                  query={schemaQuery}
                  tables={filteredSchemaTables}
                  onClose={() => setSchemaOpen(false)}
                  onQueryChange={setSchemaQuery}
                  onCopy={(value) => void copyText(value)}
                />
              )}
            </div>

            <div className="studio-panel studio-preview">
              <div className="studio-panel-heading studio-preview-heading">
                <div>
                  <h2>Preview</h2>
                  <label className="studio-field compact-field">
                    <span>Preview display name</span>
                    <input
                      {...configBuilderNoAutofillProps}
                      value={profileDisplayName}
                      onChange={(event) => setProfileDisplayName(event.target.value)}
                    />
                  </label>
                </div>
                <p className={`studio-status is-${connectionStatus}`}>
                  {connectionStatus === "connected" ? (
                    <CheckCircle2 size={15} aria-hidden="true" />
                  ) : (
                    <Database size={15} aria-hidden="true" />
                  )}
                  {connectionStatus === "connected" ? "Connected" : "Reconnect"}
                </p>
              </div>

              <div className="studio-actions">
                <button
                  className="tool-button"
                  type="button"
                  onClick={() => void copyText(renderedJson)}
                >
                  <Copy size={16} aria-hidden="true" />
                  Copy JSON
                </button>
                <button
                  className="tool-button"
                  type="button"
                  onClick={() => void copyText(encodeRenderStudioOutput(config))}
                >
                  <Copy size={16} aria-hidden="true" />
                  Copy Base64
                </button>
                <button className="tool-button" type="button" onClick={downloadJson}>
                  <Download size={16} aria-hidden="true" />
                  Download
                </button>
              </div>

              {preview.status === "error" && <p className="studio-error">{preview.message}</p>}
              {preview.status === "rendering" && <p className="studio-note">{preview.message}</p>}
              {preview.status === "idle" && <p className="studio-note">{preview.message}</p>}
              {preview.markdown ? (
                <MarkdownPreview markdown={preview.markdown} />
              ) : (
                <pre className="markdown-preview markdown-preview-source">{renderedJson}</pre>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function BlockEditor({
  block,
  index,
  queryNames,
  onChange,
  onMove,
  onRemove,
}: {
  block: TargetRenderBlock;
  index: number;
  queryNames: string[];
  onChange: (block: TargetRenderBlock) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <article className="studio-card">
      <div className="block-header">
        <strong>{blockLabel(block, index)}</strong>
        <div className="block-actions">
          <button className="text-button" type="button" onClick={() => onMove(index, -1)}>
            Up
          </button>
          <button className="text-button" type="button" onClick={() => onMove(index, 1)}>
            Down
          </button>
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
      <label className="studio-field">
        <span>Type</span>
        <select
          value={block.type}
          onChange={(event) => {
            const nextBlock = createBlock(event.target.value as TargetRenderBlock["type"]);
            if (isListLikeBlock(nextBlock) && queryNames[0]) nextBlock.query = queryNames[0];
            onChange(nextBlock);
          }}
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
                onChange({ ...block, level: Number(event.target.value) as 1 | 2 | 3 | 4 | 5 | 6 })
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
          <QuerySelect
            queryNames={queryNames}
            value={block.query}
            onChange={(query) => onChange({ ...block, query })}
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

      {block.type === "table" && (
        <>
          <QuerySelect
            queryNames={queryNames}
            value={block.query}
            onChange={(query) => onChange({ ...block, query })}
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
    </article>
  );
}

function QuerySelect({
  queryNames,
  value,
  onChange,
}: {
  queryNames: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="studio-field">
      <span>Query</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="" disabled>
          Choose query
        </option>
        {queryNames.map((name) => (
          <option value={name} key={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function updateColumn(
  columns: TargetRenderTableColumn[],
  index: number,
  column: TargetRenderTableColumn,
) {
  return columns.map((item, itemIndex) => (itemIndex === index ? column : item));
}

function SchemaDrawer({
  message,
  query,
  tables,
  onClose,
  onCopy,
  onQueryChange,
}: {
  message: string;
  query: string;
  tables: SchemaTable[];
  onClose: () => void;
  onCopy: (value: string) => void;
  onQueryChange: (value: string) => void;
}) {
  return (
    <aside className="schema-drawer" aria-label="Schema browser">
      <div className="schema-drawer-heading">
        <div>
          <p className="studio-eyebrow">Schema</p>
          <h3>Tables and columns</h3>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close schema browser"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <label className="studio-field">
        <span>Search</span>
        <input
          {...configBuilderNoAutofillProps}
          value={query}
          placeholder="repositories, commits, full_name"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      {message && <p className="studio-note">{message}</p>}
      <div className="schema-table-list">
        {tables.map((table) => (
          <details className="schema-table" key={`${table.schema}.${table.name}`}>
            <summary>
              <span>
                {table.name}
                <small>{table.type}</small>
              </span>
              <button
                className="text-button"
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  onCopy(table.name);
                }}
              >
                Copy
              </button>
            </summary>
            <div>
              {table.columns.map((column) => (
                <button
                  className="schema-column"
                  type="button"
                  key={`${table.name}.${column.name}`}
                  onClick={() => onCopy(column.name)}
                >
                  <span>{column.name}</span>
                  <small>
                    {column.dataType}
                    {column.nullable ? "" : " not null"}
                  </small>
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
    </aside>
  );
}
