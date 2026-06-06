import Ajv from "ajv";
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  Download,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import schema from "../generated/shiplog/shiplog.config.schema.json";
import { configBuilderNoAutofillProps } from "../lib/config-builder-autofill";
import {
  getConfigBuilderDeviceBlockReason,
  readConfigBuilderDevice,
  type ConfigBuilderDeviceBlockReason,
} from "../lib/config-builder-device";
import {
  buildConfig,
  createInitialBuilderForm,
  createItem,
  createPublishTarget,
  createSource,
  READ_TOKEN_ENV,
  tokenEnvForOrganization,
  WRITE_TOKEN_ENV,
  type BuilderForm,
  type CollectSource,
  type PublishTarget,
  type ResolveItem,
  type ResolveListKey,
  type SupportedProvider,
} from "../lib/config-builder-model";
import { firstInvalidBuilderTab, validateBuilderForm } from "../lib/config-builder-validation";
import {
  fallbackCommands,
  normalizeGitHubInput,
  parseLogin,
  parseRepository,
  type ResolveKind,
} from "../lib/github-resolver";

type ManualResolveTarget =
  | {
      scope: "sourceAccount";
      sourceId: string;
      label: string;
      value: string;
      commands: string[];
    }
  | {
      scope: "destinationRepository";
      targetId: string;
      label: string;
      value: string;
      commands: string[];
    }
  | {
      scope: "sourceList";
      sourceId: string;
      key: ResolveListKey;
      itemId: string;
      label: string;
      value: string;
      commands: string[];
    };

type GitHubUserResponse = {
  login: string;
  node_id: string;
  type?: string;
};

type GitHubRepositoryResponse = {
  full_name: string;
  node_id: string;
};

type BuilderTab = "profile" | "collection" | "publish";

const builderTabs: Array<{ id: BuilderTab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "collection", label: "Collection Sources" },
  { id: "publish", label: "Publish Targets" },
];

const fieldIds = {
  displayName: "display-name",
  lookbackDays: "lookback-days",
};

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function nextItemId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

async function fetchGitHubJson<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(
      response.status === 404 ? "not found or private" : `GitHub returned ${response.status}`,
    );
  }

  return response.json() as Promise<T>;
}

async function resolveGitHub(kind: ResolveKind, value: string) {
  if (kind === "repository") {
    const repository = parseRepository(value);
    if (!repository) throw new Error("enter owner/repo or a GitHub repository URL");

    const [owner, repo] = repository.split("/");
    const data = await fetchGitHubJson<GitHubRepositoryResponse>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );

    return {
      nodeId: data.node_id,
      resolvedName: data.full_name,
      message: data.full_name,
    };
  }

  const login = parseLogin(value);
  if (!login) throw new Error("enter a GitHub name or URL");

  const path =
    kind === "organization"
      ? `/orgs/${encodeURIComponent(login)}`
      : `/users/${encodeURIComponent(login)}`;
  const data = await fetchGitHubJson<GitHubUserResponse>(path);

  if (kind === "user" && data.type && data.type !== "User") {
    throw new Error("enter a GitHub user, not an organization");
  }

  return {
    nodeId: data.node_id,
    resolvedName: data.login,
    message: `@${data.login}`,
  };
}

function itemStatusText(item: ResolveItem): string {
  if (item.status === "resolving") return "Resolving";
  if (item.status === "resolved") return `Resolved ${item.message}`;
  if (item.status === "error") return item.message;
  if (item.value.trim()) return "Resolve this entry";
  return "Waiting for input";
}

function sourceSummary(source: CollectSource): string | undefined {
  if (source.account.resolvedName) return `@${source.account.resolvedName}`;
  if (source.account.value.trim()) return source.account.value.trim();
  return undefined;
}

function publishTargetSummary(target: PublishTarget): string | undefined {
  if (target.publishRepository.resolvedName) return target.publishRepository.resolvedName;
  if (target.publishRepository.value.trim()) return target.publishRepository.value.trim();
  return undefined;
}

type ConfigBuilderDeviceGateProps = {
  className?: string;
  reason?: ConfigBuilderDeviceBlockReason;
};

function ConfigBuilderDeviceGate({ className = "", reason }: ConfigBuilderDeviceGateProps) {
  const shellClassName = ["builder-shell", "builder-shell-blocked", className]
    .filter(Boolean)
    .join(" ");
  const gateMode = reason ?? "responsive";

  return (
    <section className={shellClassName}>
      <div className={`builder-panel builder-device-gate is-${gateMode}`}>
        <p className="manual-modal__eyebrow">
          <span className="narrow-message">Window too narrow</span>
          <span className="device-message">Desktop required</span>
        </p>
        <h2>
          <span className="narrow-message">Widen this browser window</span>
          <span className="device-message">Use a laptop for the config builder</span>
        </h2>
        <p>
          <span className="narrow-message">
            This looks like a desktop browser, but the current window is too narrow for the config
            builder layout. Make the window wider to continue.
          </span>
          <span className="device-message">
            This tool needs enough room for collection sources, publish targets, JSON output, and
            terminal fallback commands. Open it from a desktop browser with GitHub CLI available for
            private repository lookups.
          </span>
        </p>
        <div className="action-row">
          <a className="button button-primary" href="https://github.com/karanbalani/shiplog">
            Open GitHub
          </a>
          <a className="button button-secondary" href="/">
            Back home
          </a>
        </div>
      </div>
    </section>
  );
}

export default function ConfigBuilder() {
  const [form, setForm] = useState<BuilderForm>(() => createInitialBuilderForm());
  const config = useMemo(() => buildConfig(form), [form]);
  const generatedJson = useMemo(() => `${JSON.stringify(config, null, 2)}\n`, [config]);
  const [activeTab, setActiveTab] = useState<BuilderTab>(() =>
    firstInvalidBuilderTab(validateBuilderForm(createInitialBuilderForm())),
  );
  const [activeSourceId, setActiveSourceId] = useState("source-github-1");
  const [activePublishTargetId, setActivePublishTargetId] = useState("publish-target-github-1");
  const [builderBlockReason, setBuilderBlockReason] =
    useState<ConfigBuilderDeviceBlockReason | null>(() =>
      typeof window === "undefined"
        ? null
        : getConfigBuilderDeviceBlockReason(readConfigBuilderDevice()),
    );
  const [copied, setCopied] = useState<string | null>(null);
  const [manualResolve, setManualResolve] = useState<ManualResolveTarget | null>(null);
  const [manualNodeId, setManualNodeId] = useState("");
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showPublishTargetPicker, setShowPublishTargetPicker] = useState(false);

  useEffect(() => {
    function syncDeviceState() {
      setBuilderBlockReason(getConfigBuilderDeviceBlockReason(readConfigBuilderDevice()));
    }

    syncDeviceState();
    window.addEventListener("resize", syncDeviceState);
    return () => window.removeEventListener("resize", syncDeviceState);
  }, []);

  useEffect(() => {
    if (!form.sources.some((source) => source.id === activeSourceId)) {
      setActiveSourceId(form.sources[0]?.id ?? "");
    }
  }, [activeSourceId, form.sources]);

  useEffect(() => {
    if (!form.publishTargets.some((target) => target.id === activePublishTargetId)) {
      setActivePublishTargetId(form.publishTargets[0]?.id ?? "");
    }
  }, [activePublishTargetId, form.publishTargets]);

  const formValidation = useMemo(() => validateBuilderForm(form), [form]);
  const schemaValidation = useMemo(() => {
    const ok = validate(config);

    return {
      ok,
      normalizedJson: generatedJson,
    };
  }, [config, generatedJson]);

  const ready = schemaValidation.ok && formValidation.ready;
  const base64 = ready ? toBase64(schemaValidation.normalizedJson) : "";

  function updateField<K extends "displayName" | "lookbackDays">(key: K, value: BuilderForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updatePublishTargetField<K extends "branch" | "path">(
    targetId: string,
    key: K,
    value: PublishTarget[K],
  ) {
    setForm((current) => ({
      ...current,
      publishTargets: current.publishTargets.map((target) =>
        target.id === targetId ? { ...target, [key]: value } : target,
      ),
    }));
  }

  function updateSourceAccount(sourceId: string, value: string) {
    setForm((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              account: {
                ...source.account,
                value,
                nodeId: "",
                resolvedName: "",
                status: "idle",
                message: "",
                commands: undefined,
              },
            }
          : source,
      ),
    }));
  }

  function updatePublishTargetRepository(targetId: string, value: string) {
    setForm((current) => ({
      ...current,
      publishTargets: current.publishTargets.map((target) =>
        target.id === targetId
          ? {
              ...target,
              publishRepository: {
                ...target.publishRepository,
                value,
                nodeId: "",
                resolvedName: "",
                status: "idle",
                message: "",
                commands: undefined,
              },
            }
          : target,
      ),
    }));
  }

  function updateSourceListItem(sourceId: string, key: ResolveListKey, id: string, value: string) {
    setForm((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              [key]: source[key].map((item) =>
                item.id === id
                  ? {
                      ...item,
                      value,
                      nodeId: "",
                      resolvedName: "",
                      status: "idle",
                      message: "",
                      commands: undefined,
                    }
                  : item,
              ),
            }
          : source,
      ),
    }));
  }

  function addSource(provider: SupportedProvider) {
    const id = nextItemId("source");
    setForm((current) => ({
      ...current,
      sources: [...current.sources, { ...createSource(id), provider }],
    }));
    setActiveTab("collection");
    setActiveSourceId(id);
    setShowSourcePicker(false);
  }

  function removeSource(sourceId: string) {
    setForm((current) => ({
      ...current,
      sources:
        current.sources.length > 1
          ? current.sources.filter((source) => source.id !== sourceId)
          : current.sources,
    }));
  }

  function addPublishTarget(provider: SupportedProvider) {
    const id = nextItemId("publish-target");
    setForm((current) => ({
      ...current,
      publishTargets: [...current.publishTargets, { ...createPublishTarget(id), provider }],
    }));
    setActiveTab("publish");
    setActivePublishTargetId(id);
    setShowPublishTargetPicker(false);
  }

  function removePublishTarget(targetId: string) {
    setForm((current) => ({
      ...current,
      publishTargets:
        current.publishTargets.length > 1
          ? current.publishTargets.filter((target) => target.id !== targetId)
          : current.publishTargets,
    }));
  }

  function addSourceListItem(sourceId: string, key: ResolveListKey) {
    setForm((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              [key]: [...source[key], createItem(nextItemId(`${sourceId}-${key}`))],
            }
          : source,
      ),
    }));
  }

  function removeSourceListItem(sourceId: string, key: ResolveListKey, id: string) {
    setForm((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              [key]: source[key].filter((item) => item.id !== id),
            }
          : source,
      ),
    }));
  }

  function openManualResolve(target: ManualResolveTarget) {
    setManualResolve(target);
    setManualNodeId("");
  }

  function closeManualResolve() {
    setManualResolve(null);
    setManualNodeId("");
  }

  function submitManualNodeId() {
    if (!manualResolve) return;

    const trimmed = manualNodeId.trim();
    if (!trimmed) return;

    if (manualResolve.scope === "sourceAccount") {
      applyManualNodeIdToSourceAccount(manualResolve.sourceId, trimmed);
    } else if (manualResolve.scope === "destinationRepository") {
      applyManualNodeIdToPublishTarget(manualResolve.targetId, trimmed);
    } else {
      applyManualNodeIdToSourceList(
        manualResolve.sourceId,
        manualResolve.key,
        manualResolve.itemId,
        trimmed,
      );
    }

    closeManualResolve();
  }

  async function resolveSourceAccount(sourceId: string) {
    const source = form.sources.find((candidate) => candidate.id === sourceId);
    if (!source) return;

    setForm((current) => ({
      ...current,
      sources: current.sources.map((candidate) =>
        candidate.id === sourceId
          ? {
              ...candidate,
              account: { ...candidate.account, status: "resolving", message: "" },
            }
          : candidate,
      ),
    }));

    const commands = fallbackCommands("user", source.account.value);

    try {
      const resolved = await resolveGitHub("user", source.account.value);
      setForm((current) => ({
        ...current,
        sources: current.sources.map((candidate) =>
          candidate.id === sourceId
            ? {
                ...candidate,
                account: {
                  ...candidate.account,
                  ...resolved,
                  value: resolved.resolvedName,
                  status: "resolved",
                  commands: undefined,
                },
              }
            : candidate,
        ),
      }));
    } catch (error) {
      setForm((current) => ({
        ...current,
        sources: current.sources.map((candidate) =>
          candidate.id === sourceId
            ? {
                ...candidate,
                account: {
                  ...candidate.account,
                  nodeId: "",
                  resolvedName: "",
                  status: "error",
                  message: error instanceof Error ? error.message : "could not resolve",
                  commands,
                },
              }
            : candidate,
        ),
      }));
      if (commands.length > 0) {
        openManualResolve({
          scope: "sourceAccount",
          sourceId,
          label: "GitHub username",
          value: source.account.value,
          commands,
        });
      }
    }
  }

  async function resolvePublishTargetRepository(targetId: string) {
    const target = form.publishTargets.find((candidate) => candidate.id === targetId);
    const item = target?.publishRepository;
    if (!item) return;

    setForm((current) => ({
      ...current,
      publishTargets: current.publishTargets.map((candidate) =>
        candidate.id === targetId
          ? {
              ...candidate,
              publishRepository: {
                ...candidate.publishRepository,
                status: "resolving",
                message: "",
              },
            }
          : candidate,
      ),
    }));

    const commands = fallbackCommands("repository", item.value, WRITE_TOKEN_ENV);

    try {
      const resolved = await resolveGitHub("repository", item.value);
      setForm((current) => ({
        ...current,
        publishTargets: current.publishTargets.map((candidate) =>
          candidate.id === targetId
            ? {
                ...candidate,
                publishRepository: {
                  ...candidate.publishRepository,
                  ...resolved,
                  value: resolved.resolvedName,
                  status: "resolved",
                  commands: undefined,
                },
              }
            : candidate,
        ),
      }));
    } catch (error) {
      setForm((current) => ({
        ...current,
        publishTargets: current.publishTargets.map((candidate) =>
          candidate.id === targetId
            ? {
                ...candidate,
                publishRepository: {
                  ...candidate.publishRepository,
                  nodeId: "",
                  resolvedName: "",
                  status: "error",
                  message: error instanceof Error ? error.message : "could not resolve",
                  commands,
                },
              }
            : candidate,
        ),
      }));
      if (commands.length > 0) {
        openManualResolve({
          scope: "destinationRepository",
          targetId,
          label: "Publish repository",
          value: item.value,
          commands,
        });
      }
    }
  }

  async function resolveSourceListItem(
    sourceId: string,
    key: ResolveListKey,
    id: string,
    label: string,
    kind: ResolveKind,
  ) {
    const source = form.sources.find((candidate) => candidate.id === sourceId);
    const item = source?.[key].find((candidate) => candidate.id === id);
    if (!item) return;

    setForm((current) => ({
      ...current,
      sources: current.sources.map((candidate) =>
        candidate.id === sourceId
          ? {
              ...candidate,
              [key]: candidate[key].map((listItem) =>
                listItem.id === id ? { ...listItem, status: "resolving", message: "" } : listItem,
              ),
            }
          : candidate,
      ),
    }));

    const commands = fallbackCommands(kind, item.value);

    try {
      const resolved = await resolveGitHub(kind, item.value);
      setForm((current) => ({
        ...current,
        sources: current.sources.map((candidate) =>
          candidate.id === sourceId
            ? {
                ...candidate,
                [key]: candidate[key].map((listItem) =>
                  listItem.id === id
                    ? {
                        ...listItem,
                        ...resolved,
                        value: resolved.resolvedName,
                        status: "resolved",
                        commands: undefined,
                      }
                    : listItem,
                ),
              }
            : candidate,
        ),
      }));
    } catch (error) {
      setForm((current) => ({
        ...current,
        sources: current.sources.map((candidate) =>
          candidate.id === sourceId
            ? {
                ...candidate,
                [key]: candidate[key].map((listItem) =>
                  listItem.id === id
                    ? {
                        ...listItem,
                        nodeId: "",
                        resolvedName: "",
                        status: "error",
                        message: error instanceof Error ? error.message : "could not resolve",
                        commands,
                      }
                    : listItem,
                ),
              }
            : candidate,
        ),
      }));
      if (commands.length > 0) {
        openManualResolve({
          scope: "sourceList",
          sourceId,
          key,
          itemId: id,
          label,
          value: item.value,
          commands,
        });
      }
    }
  }

  function applyManualNodeIdToSourceAccount(sourceId: string, nodeId: string) {
    const trimmed = nodeId.trim();
    setForm((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              account: {
                ...source.account,
                nodeId: trimmed,
                resolvedName:
                  source.account.resolvedName || normalizeGitHubInput(source.account.value),
                value: source.account.resolvedName || normalizeGitHubInput(source.account.value),
                status: trimmed ? "resolved" : "error",
                message: trimmed ? "manual node ID" : "paste the node_id output",
                commands: trimmed ? undefined : source.account.commands,
              },
            }
          : source,
      ),
    }));
  }

  function applyManualNodeIdToPublishTarget(targetId: string, nodeId: string) {
    const trimmed = nodeId.trim();
    setForm((current) => ({
      ...current,
      publishTargets: current.publishTargets.map((target) =>
        target.id === targetId
          ? {
              ...target,
              publishRepository: {
                ...target.publishRepository,
                nodeId: trimmed,
                resolvedName:
                  target.publishRepository.resolvedName ||
                  normalizeGitHubInput(target.publishRepository.value),
                value:
                  target.publishRepository.resolvedName ||
                  normalizeGitHubInput(target.publishRepository.value),
                status: trimmed ? "resolved" : "error",
                message: trimmed ? "manual node ID" : "paste the node_id output",
                commands: trimmed ? undefined : target.publishRepository.commands,
              },
            }
          : target,
      ),
    }));
  }

  function applyManualNodeIdToSourceList(
    sourceId: string,
    key: ResolveListKey,
    id: string,
    nodeId: string,
  ) {
    const trimmed = nodeId.trim();
    setForm((current) => ({
      ...current,
      sources: current.sources.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              [key]: source[key].map((item) =>
                item.id === id
                  ? {
                      ...item,
                      nodeId: trimmed,
                      resolvedName: item.resolvedName || normalizeGitHubInput(item.value),
                      value: item.resolvedName || normalizeGitHubInput(item.value),
                      status: trimmed ? "resolved" : "error",
                      message: trimmed ? "manual node ID" : "paste the node_id output",
                      commands: trimmed ? undefined : item.commands,
                    }
                  : item,
              ),
            }
          : source,
      ),
    }));
  }

  async function copyValue(label: string, value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }

  function downloadJson() {
    if (!ready) return;
    const blob = new Blob([schemaValidation.normalizedJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "shiplog.config.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    const nextForm = createInitialBuilderForm();
    setForm(nextForm);
    setActiveTab(firstInvalidBuilderTab(validateBuilderForm(nextForm)));
    setActiveSourceId("source-github-1");
    setActivePublishTargetId("publish-target-github-1");
    setShowSourcePicker(false);
    setShowPublishTargetPicker(false);
    closeManualResolve();
  }

  function renderResolveNote(item: ResolveItem, onManualResolve?: () => void) {
    const showStatus = item.status === "resolving" || item.status === "resolved";
    const showManualResolve =
      item.status === "error" && item.commands && item.commands.length > 0 && onManualResolve;

    if (!showStatus && !showManualResolve) return null;

    return (
      <div className={`resolve-note is-${item.status}`}>
        {showStatus && <span>{itemStatusText(item)}</span>}
        {showManualResolve && (
          <button className="text-button" type="button" onClick={onManualResolve}>
            Open manual resolver
          </button>
        )}
      </div>
    );
  }

  function renderFieldError(id: string, error: string | undefined) {
    return error ? (
      <span className="field-error" id={id}>
        <CircleAlert aria-hidden="true" size={15} />
        {error}
      </span>
    ) : null;
  }

  function renderList(
    source: CollectSource,
    key: ResolveListKey,
    label: string,
    itemLabel: string,
    addLabel: string,
    placeholder: string,
    kind: ResolveKind,
  ) {
    const items = source[key];
    const listErrors = formValidation.sources[source.id]?.[key] ?? {};

    return (
      <details className="resolver-group" open>
        <summary>
          <span>{label}</span>
          <span className="resolver-count">({items.length})</span>
        </summary>
        <div className="resolver-items">
          {items.length === 0 && <p className="empty-note">No entries.</p>}
          {items.map((item, index) => (
            <div
              className={`resolver-item ${listErrors[item.id] ? "is-invalid" : ""}`}
              key={item.id}
            >
              <div
                className={`resolve-control ${item.status === "resolved" ? "is-resolved" : ""} ${
                  listErrors[item.id] ? "is-invalid" : ""
                }`}
              >
                <input
                  {...configBuilderNoAutofillProps}
                  aria-label={`${label} ${index + 1}`}
                  aria-describedby={`${key}-${item.id}-error`}
                  aria-invalid={Boolean(listErrors[item.id])}
                  id={`${key}-${item.id}`}
                  placeholder={placeholder}
                  readOnly={item.status === "resolved"}
                  value={item.value}
                  onChange={(event) =>
                    updateSourceListItem(source.id, key, item.id, event.target.value)
                  }
                />
                {item.status !== "resolved" && (
                  <button
                    className="tool-button"
                    disabled={!item.value.trim() || item.status === "resolving"}
                    type="button"
                    onClick={() => resolveSourceListItem(source.id, key, item.id, itemLabel, kind)}
                  >
                    <Search aria-hidden="true" size={18} />
                    Resolve
                  </button>
                )}
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Remove ${label} ${index + 1}`}
                  onClick={() => removeSourceListItem(source.id, key, item.id)}
                >
                  <Trash2 aria-hidden="true" size={18} />
                </button>
              </div>
              {renderFieldError(`${key}-${item.id}-error`, listErrors[item.id])}
              {item.value.trim() &&
                renderResolveNote(item, () =>
                  openManualResolve({
                    scope: "sourceList",
                    sourceId: source.id,
                    key,
                    itemId: item.id,
                    label: itemLabel,
                    value: item.value,
                    commands: item.commands ?? fallbackCommands(kind, item.value),
                  }),
                )}
            </div>
          ))}
          <button
            className="tool-button"
            type="button"
            onClick={() => addSourceListItem(source.id, key)}
          >
            <Plus aria-hidden="true" size={18} />
            {addLabel}
          </button>
        </div>
      </details>
    );
  }

  if (builderBlockReason) {
    return <ConfigBuilderDeviceGate reason={builderBlockReason} />;
  }

  return (
    <section className="builder-shell">
      <ConfigBuilderDeviceGate className="builder-device-fallback" />
      <div className="builder-layout builder-shell-interactive">
        <div className="builder-panel input-panel">
          <div className="panel-heading input-heading">
            <div>
              <h2>Inputs</h2>
              <p>GitHub names and URLs become stable node IDs in the generated config.</p>
            </div>
            <button className="tool-button" type="button" onClick={reset}>
              <RefreshCw aria-hidden="true" size={18} />
              Reset
            </button>
          </div>

          <div className="builder-tabs" role="tablist" aria-label="Config sections">
            {builderTabs.map((tab) => {
              const tabStatus = formValidation.tabs[tab.id];

              return (
                <button
                  aria-selected={activeTab === tab.id}
                  className="builder-tab"
                  key={tab.id}
                  role="tab"
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className={`tab-status is-${tabStatus}`}>
                    {tabStatus === "valid" ? (
                      <CheckCircle2 aria-hidden="true" size={17} />
                    ) : (
                      <CircleAlert aria-hidden="true" size={17} />
                    )}
                  </span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <p className="builder-terminal-note">
            Private repositories require GitHub CLI for manual ID lookup.
          </p>

          <div className="form-sections" role="tabpanel">
            {activeTab === "profile" && (
              <section className="builder-form-section profile-section">
                <div className="section-heading">
                  <h3>Profile</h3>
                </div>
                <div className="field-grid">
                  <label
                    className={`field ${formValidation.profile.displayName ? "is-invalid" : ""}`}
                    htmlFor={fieldIds.displayName}
                  >
                    <span>Display name</span>
                    <input
                      {...configBuilderNoAutofillProps}
                      aria-label="Display name"
                      aria-describedby={`${fieldIds.displayName}-error`}
                      aria-invalid={Boolean(formValidation.profile.displayName)}
                      id={fieldIds.displayName}
                      placeholder="Your display name"
                      value={form.displayName}
                      onChange={(event) => updateField("displayName", event.target.value)}
                    />
                    {renderFieldError(
                      `${fieldIds.displayName}-error`,
                      formValidation.profile.displayName,
                    )}
                  </label>

                  <label
                    className={`field ${formValidation.profile.lookbackDays ? "is-invalid" : ""}`}
                    htmlFor={fieldIds.lookbackDays}
                  >
                    <span>Lookback days</span>
                    <input
                      {...configBuilderNoAutofillProps}
                      aria-label="Lookback days"
                      aria-describedby={`${fieldIds.lookbackDays}-error`}
                      aria-invalid={Boolean(formValidation.profile.lookbackDays)}
                      id={fieldIds.lookbackDays}
                      min={0}
                      max={90}
                      type="number"
                      value={form.lookbackDays}
                      onChange={(event) => updateField("lookbackDays", Number(event.target.value))}
                    />
                    {renderFieldError(
                      `${fieldIds.lookbackDays}-error`,
                      formValidation.profile.lookbackDays,
                    )}
                  </label>
                </div>
              </section>
            )}

            {activeTab === "collection" && (
              <section className="builder-form-section">
                <div className="section-heading section-heading-row">
                  <h3>Collection Sources</h3>
                  <button
                    className="tool-button"
                    type="button"
                    onClick={() => setShowSourcePicker(true)}
                  >
                    <Plus aria-hidden="true" size={18} />
                    Add source
                  </button>
                </div>

                <div className="source-stack">
                  {form.sources.map((source, index) => {
                    const sourceTokenEnvs = source.restrictedOrganizations
                      .filter((item) => item.status === "resolved")
                      .map((item) => tokenEnvForOrganization(item.resolvedName));
                    const sourceAccountId = `${source.id}-github-username`;
                    const sourceSummaryText = sourceSummary(source);
                    const sourceValidation = formValidation.sources[source.id];
                    const isActiveSource = activeSourceId === source.id;
                    const needsAttention = Boolean(
                      sourceValidation &&
                      (sourceValidation.account ||
                        Object.keys(sourceValidation.restrictedOrganizations).length > 0 ||
                        Object.keys(sourceValidation.ignoredOrganizations).length > 0 ||
                        Object.keys(sourceValidation.ignoredRepositories).length > 0),
                    );

                    return (
                      <article
                        className={`source-card ${isActiveSource ? "is-active" : ""}`}
                        key={source.id}
                      >
                        <div className="source-header">
                          <button
                            aria-expanded={isActiveSource}
                            className="card-toggle"
                            type="button"
                            onClick={() => setActiveSourceId(source.id)}
                          >
                            <span>
                              <h4>GitHub</h4>
                              {sourceSummaryText && (
                                <span className="card-summary">{sourceSummaryText}</span>
                              )}
                            </span>
                            <span
                              className={`card-state ${needsAttention ? "is-invalid" : "is-valid"}`}
                            >
                              {needsAttention
                                ? "Action required"
                                : isActiveSource
                                  ? "Editing"
                                  : "Edit"}
                            </span>
                          </button>
                          <button
                            aria-label={`Remove source ${index + 1}`}
                            className="icon-button"
                            disabled={form.sources.length === 1}
                            type="button"
                            onClick={() => removeSource(source.id)}
                          >
                            <Trash2 aria-hidden="true" size={18} />
                          </button>
                        </div>

                        {isActiveSource && (
                          <div className="field-grid card-body">
                            <div
                              className={`field field-wide ${
                                sourceValidation?.account ? "is-invalid" : ""
                              }`}
                            >
                              <label className="field-label" htmlFor={sourceAccountId}>
                                GitHub username
                              </label>
                              <div
                                className={`resolve-control ${
                                  source.account.status === "resolved" ? "is-resolved" : ""
                                } ${sourceValidation?.account ? "is-invalid" : ""}`}
                              >
                                <input
                                  {...configBuilderNoAutofillProps}
                                  aria-label={`Source ${index + 1} GitHub username`}
                                  aria-describedby={`${sourceAccountId}-error`}
                                  aria-invalid={Boolean(sourceValidation?.account)}
                                  id={sourceAccountId}
                                  placeholder="octocat or github.com/octocat"
                                  readOnly={source.account.status === "resolved"}
                                  value={source.account.value}
                                  onChange={(event) =>
                                    updateSourceAccount(source.id, event.target.value)
                                  }
                                />
                                {source.account.status === "resolved" ? (
                                  <button
                                    className="icon-button"
                                    type="button"
                                    aria-label={`Clear source ${index + 1} GitHub username`}
                                    onClick={() => updateSourceAccount(source.id, "")}
                                  >
                                    <Trash2 aria-hidden="true" size={18} />
                                  </button>
                                ) : (
                                  <button
                                    className="tool-button"
                                    disabled={
                                      !source.account.value.trim() ||
                                      source.account.status === "resolving"
                                    }
                                    type="button"
                                    onClick={() => resolveSourceAccount(source.id)}
                                  >
                                    <Search aria-hidden="true" size={18} />
                                    Resolve
                                  </button>
                                )}
                              </div>
                              {renderFieldError(
                                `${sourceAccountId}-error`,
                                sourceValidation?.account,
                              )}
                              {source.account.value.trim() &&
                                renderResolveNote(source.account, () =>
                                  openManualResolve({
                                    scope: "sourceAccount",
                                    sourceId: source.id,
                                    label: "GitHub username",
                                    value: source.account.value,
                                    commands:
                                      source.account.commands ??
                                      fallbackCommands("user", source.account.value),
                                  }),
                                )}
                            </div>

                            <div className="env-panel field-wide">
                              <strong>Generated source env names</strong>
                              <div>
                                <code>{READ_TOKEN_ENV}</code>
                                <span>read token for terminal and workflows</span>
                              </div>
                              {sourceTokenEnvs.map((tokenEnv) => (
                                <div key={tokenEnv}>
                                  <code>{tokenEnv}</code>
                                  <span>restricted organization read token</span>
                                </div>
                              ))}
                            </div>

                            <div className="field-wide resolver-stack">
                              {renderList(
                                source,
                                "restrictedOrganizations",
                                "Restricted organizations",
                                "Restricted organization",
                                "Add restricted org",
                                "org-login or github.com/org-login",
                                "organization",
                              )}
                              {renderList(
                                source,
                                "ignoredOrganizations",
                                "Ignored organizations",
                                "Ignored organization",
                                "Add ignored org",
                                "org-login or github.com/org-login",
                                "organization",
                              )}
                              {renderList(
                                source,
                                "ignoredRepositories",
                                "Ignored repositories",
                                "Ignored repository",
                                "Add ignored repo",
                                "owner/repo or github.com/owner/repo",
                                "repository",
                              )}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {activeTab === "publish" && (
              <section className="builder-form-section">
                <div className="section-heading section-heading-row">
                  <h3>Publish Targets</h3>
                  <button
                    className="tool-button"
                    type="button"
                    onClick={() => setShowPublishTargetPicker(true)}
                  >
                    <Plus aria-hidden="true" size={18} />
                    Add target
                  </button>
                </div>

                <div className="source-stack">
                  {form.publishTargets.map((target, index) => {
                    const targetRepositoryId = `${target.id}-publish-repository`;
                    const targetBranchId = `${target.id}-publish-branch`;
                    const targetPathId = `${target.id}-publish-path`;
                    const targetSummaryText = publishTargetSummary(target);
                    const targetValidation = formValidation.publishTargets[target.id];
                    const isActiveTarget = activePublishTargetId === target.id;
                    const needsAttention = Boolean(
                      targetValidation &&
                      (targetValidation.publishRepository ||
                        targetValidation.branch ||
                        targetValidation.path),
                    );

                    return (
                      <article
                        className={`source-card ${isActiveTarget ? "is-active" : ""}`}
                        key={target.id}
                      >
                        <div className="source-header">
                          <button
                            aria-expanded={isActiveTarget}
                            className="card-toggle"
                            type="button"
                            onClick={() => setActivePublishTargetId(target.id)}
                          >
                            <span>
                              <h4>GitHub</h4>
                              {targetSummaryText && (
                                <span className="card-summary">{targetSummaryText}</span>
                              )}
                            </span>
                            <span
                              className={`card-state ${needsAttention ? "is-invalid" : "is-valid"}`}
                            >
                              {needsAttention
                                ? "Action required"
                                : isActiveTarget
                                  ? "Editing"
                                  : "Edit"}
                            </span>
                          </button>
                          <button
                            aria-label={`Remove publish target ${index + 1}`}
                            className="icon-button"
                            disabled={form.publishTargets.length === 1}
                            type="button"
                            onClick={() => removePublishTarget(target.id)}
                          >
                            <Trash2 aria-hidden="true" size={18} />
                          </button>
                        </div>

                        {isActiveTarget && (
                          <div className="field-grid card-body">
                            <div
                              className={`field field-wide ${
                                targetValidation?.publishRepository ? "is-invalid" : ""
                              }`}
                            >
                              <label className="field-label" htmlFor={targetRepositoryId}>
                                Publish repository
                              </label>
                              <div
                                className={`resolve-control ${
                                  target.publishRepository.status === "resolved"
                                    ? "is-resolved"
                                    : ""
                                } ${targetValidation?.publishRepository ? "is-invalid" : ""}`}
                              >
                                <input
                                  {...configBuilderNoAutofillProps}
                                  aria-label={`Publish target ${index + 1} repository`}
                                  aria-describedby={`${targetRepositoryId}-error`}
                                  aria-invalid={Boolean(targetValidation?.publishRepository)}
                                  id={targetRepositoryId}
                                  placeholder="owner/repo or github.com/owner/repo"
                                  readOnly={target.publishRepository.status === "resolved"}
                                  value={target.publishRepository.value}
                                  onChange={(event) =>
                                    updatePublishTargetRepository(target.id, event.target.value)
                                  }
                                />
                                {target.publishRepository.status === "resolved" ? (
                                  <button
                                    className="icon-button"
                                    type="button"
                                    aria-label={`Clear publish target ${index + 1} repository`}
                                    onClick={() => updatePublishTargetRepository(target.id, "")}
                                  >
                                    <Trash2 aria-hidden="true" size={18} />
                                  </button>
                                ) : (
                                  <button
                                    className="tool-button"
                                    disabled={
                                      !target.publishRepository.value.trim() ||
                                      target.publishRepository.status === "resolving"
                                    }
                                    type="button"
                                    onClick={() => resolvePublishTargetRepository(target.id)}
                                  >
                                    <Search aria-hidden="true" size={18} />
                                    Resolve
                                  </button>
                                )}
                              </div>
                              {renderFieldError(
                                `${targetRepositoryId}-error`,
                                targetValidation?.publishRepository,
                              )}
                              {target.publishRepository.value.trim() &&
                                renderResolveNote(target.publishRepository, () =>
                                  openManualResolve({
                                    scope: "destinationRepository",
                                    targetId: target.id,
                                    label: "Publish repository",
                                    value: target.publishRepository.value,
                                    commands:
                                      target.publishRepository.commands ??
                                      fallbackCommands(
                                        "repository",
                                        target.publishRepository.value,
                                        WRITE_TOKEN_ENV,
                                      ),
                                  }),
                                )}
                            </div>

                            <label
                              className={`field ${targetValidation?.branch ? "is-invalid" : ""}`}
                              htmlFor={targetBranchId}
                            >
                              <span>Publish branch</span>
                              <input
                                {...configBuilderNoAutofillProps}
                                aria-label={`Publish target ${index + 1} branch`}
                                aria-describedby={`${targetBranchId}-error`}
                                aria-invalid={Boolean(targetValidation?.branch)}
                                id={targetBranchId}
                                value={target.branch}
                                onChange={(event) =>
                                  updatePublishTargetField(target.id, "branch", event.target.value)
                                }
                              />
                              {renderFieldError(
                                `${targetBranchId}-error`,
                                targetValidation?.branch,
                              )}
                            </label>

                            <label
                              className={`field ${targetValidation?.path ? "is-invalid" : ""}`}
                              htmlFor={targetPathId}
                            >
                              <span>Publish path</span>
                              <input
                                {...configBuilderNoAutofillProps}
                                aria-label={`Publish target ${index + 1} path`}
                                aria-describedby={`${targetPathId}-error`}
                                aria-invalid={Boolean(targetValidation?.path)}
                                id={targetPathId}
                                value={target.path}
                                onChange={(event) =>
                                  updatePublishTargetField(target.id, "path", event.target.value)
                                }
                              />
                              {renderFieldError(`${targetPathId}-error`, targetValidation?.path)}
                            </label>

                            <div className="env-panel field-wide">
                              <strong>Generated publish target env names</strong>
                              <div>
                                <code>{WRITE_TOKEN_ENV}</code>
                                <span>write token for README publishing</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="builder-panel output-panel">
          <div className="panel-heading output-heading">
            <div>
              <h2>Output</h2>
              <p>Copy JSON locally, or Base64 for workflows.</p>
            </div>
            <div className={ready ? "status is-valid" : "status is-invalid"}>
              {ready ? (
                <CheckCircle2 aria-hidden="true" size={18} />
              ) : (
                <CircleAlert aria-hidden="true" size={18} />
              )}
              {ready ? "Ready" : "Fix inputs"}
            </div>
          </div>

          <div className="action-row">
            <button
              className="tool-button"
              disabled={!ready}
              type="button"
              onClick={() => copyValue("json", schemaValidation.normalizedJson)}
            >
              <Copy aria-hidden="true" size={18} />
              {copied === "json" ? "Copied" : "Copy JSON"}
            </button>
            <button
              className="tool-button"
              disabled={!ready}
              type="button"
              onClick={() => copyValue("base64", base64)}
            >
              <Copy aria-hidden="true" size={18} />
              {copied === "base64" ? "Copied" : "Copy Base64"}
            </button>
            <button className="tool-button" disabled={!ready} type="button" onClick={downloadJson}>
              <Download aria-hidden="true" size={18} />
              Download
            </button>
          </div>

          <pre className="json-preview">{schemaValidation.normalizedJson}</pre>
        </div>
      </div>
      {showSourcePicker && (
        <div className="manual-modal-backdrop">
          <dialog open aria-labelledby="source-picker-title" className="manual-modal source-picker">
            <div className="manual-modal__header">
              <div>
                <p className="manual-modal__eyebrow">New source</p>
                <h2 id="source-picker-title">Choose provider</h2>
              </div>
              <button
                aria-label="Back to builder"
                className="icon-button"
                type="button"
                onClick={() => setShowSourcePicker(false)}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="provider-choice-grid">
              <button className="provider-choice" type="button" onClick={() => addSource("github")}>
                <span>GitHub</span>
                <small>Issues, pull requests, repositories</small>
              </button>
            </div>
          </dialog>
        </div>
      )}
      {showPublishTargetPicker && (
        <div className="manual-modal-backdrop">
          <dialog
            open
            aria-labelledby="publish-target-picker-title"
            className="manual-modal source-picker"
          >
            <div className="manual-modal__header">
              <div>
                <p className="manual-modal__eyebrow">New publish target</p>
                <h2 id="publish-target-picker-title">Choose provider</h2>
              </div>
              <button
                aria-label="Back to builder"
                className="icon-button"
                type="button"
                onClick={() => setShowPublishTargetPicker(false)}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="provider-choice-grid">
              <button
                className="provider-choice"
                type="button"
                onClick={() => addPublishTarget("github")}
              >
                <span>GitHub</span>
                <small>Publish rendered README</small>
              </button>
            </div>
          </dialog>
        </div>
      )}
      {manualResolve && (
        <div className="manual-modal-backdrop">
          <dialog open aria-labelledby="manual-resolve-title" className="manual-modal">
            <div className="manual-modal__header">
              <div>
                <p className="manual-modal__eyebrow">Manual resolve</p>
                <h2 id="manual-resolve-title">{manualResolve.label}</h2>
              </div>
              <button
                aria-label="Back to builder"
                className="icon-button"
                type="button"
                onClick={closeManualResolve}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <p className="manual-modal__copy">
              We could not read <strong>{manualResolve.value}</strong> from public GitHub. Run one
              command with the right token available, then paste only the <code>node_id</code>{" "}
              output here.
            </p>

            <div className="manual-command-stack">
              {manualResolve.commands.map((command, index) => (
                <div className="manual-command" key={command}>
                  <code>{command}</code>
                  <button
                    className="tool-button"
                    type="button"
                    onClick={() => copyValue(`manual-command-${index}`, command)}
                  >
                    <Copy aria-hidden="true" size={18} />
                    {copied === `manual-command-${index}` ? "Copied" : "Copy"}
                  </button>
                </div>
              ))}
            </div>

            <label className="field" htmlFor="manual-node-id">
              <span>GitHub node_id</span>
              <input
                {...configBuilderNoAutofillProps}
                autoFocus
                aria-label="GitHub node_id"
                id="manual-node-id"
                placeholder="paste node_id"
                value={manualNodeId}
                onChange={(event) => setManualNodeId(event.target.value)}
              />
            </label>

            <div className="manual-modal__actions">
              <button className="tool-button" type="button" onClick={closeManualResolve}>
                Back to builder
              </button>
              <button
                className="tool-button manual-modal__primary"
                disabled={!manualNodeId.trim()}
                type="button"
                onClick={submitManualNodeId}
              >
                Save node ID
              </button>
            </div>
          </dialog>
        </div>
      )}
    </section>
  );
}
