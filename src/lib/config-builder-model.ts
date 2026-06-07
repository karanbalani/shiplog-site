export const READ_TOKEN_ENV = "GH_RO_CLASSIC_TOKEN";
export const WRITE_TOKEN_ENV = "GH_RW_REPO_TOKEN";
export const SHIPLOG_CONFIG_SCHEMA_URL =
  "https://shiplog.karanbalani.tech/schemas/shiplog.config.schema.json";

export type ResolveStatus = "idle" | "resolving" | "resolved" | "error";
export type ResolveListKey =
  | "restrictedOrganizations"
  | "ignoredOrganizations"
  | "ignoredRepositories";
export type SupportedProvider = "github";

export type ResolveItem = {
  id: string;
  value: string;
  nodeId: string;
  resolvedName: string;
  status: ResolveStatus;
  message: string;
  commands?: string[];
};

export type CollectSource = {
  id: string;
  provider: SupportedProvider;
  account: ResolveItem;
  restrictedOrganizations: ResolveItem[];
  ignoredOrganizations: ResolveItem[];
  ignoredRepositories: ResolveItem[];
};

export type PublishTarget = {
  id: string;
  provider: SupportedProvider;
  publishRepository: ResolveItem;
  branch: string;
  path: string;
};

export type BuilderForm = {
  displayName: string;
  lookbackDays: number;
  sources: CollectSource[];
  publishTargets: PublishTarget[];
};

export function createItem(id: string, value = ""): ResolveItem {
  return {
    id,
    value,
    nodeId: "",
    resolvedName: "",
    status: "idle",
    message: "",
  };
}

export function createSource(id: string): CollectSource {
  return {
    id,
    provider: "github",
    account: createItem(`${id}-account`),
    restrictedOrganizations: [],
    ignoredOrganizations: [],
    ignoredRepositories: [],
  };
}

export function createPublishTarget(id: string): PublishTarget {
  return {
    id,
    provider: "github",
    publishRepository: createItem(`${id}-repository`),
    branch: "main",
    path: "README.md",
  };
}

export function createInitialBuilderForm(): BuilderForm {
  return {
    displayName: "",
    lookbackDays: 7,
    sources: [createSource("source-github-1")],
    publishTargets: [createPublishTarget("publish-target-github-1")],
  };
}

export function tokenEnvForOrganization(login: string): string {
  const normalized = login
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `GH_RO_${normalized || "ORGANIZATION"}_PAT_TOKEN`;
}

export function buildConfig(form: BuilderForm) {
  return {
    $schema: SHIPLOG_CONFIG_SCHEMA_URL,
    version: 1,
    profile: {
      displayName: form.displayName.trim(),
    },
    collect: {
      lookbackDays: Number(form.lookbackDays),
      accounts: form.sources.map((source) => {
        const organizationPatTokens = source.restrictedOrganizations
          .filter((item) => item.nodeId)
          .map((item) => ({
            organizationId: item.nodeId,
            tokenEnv: tokenEnvForOrganization(item.resolvedName),
          }));

        return {
          provider: source.provider,
          accountId: source.account.nodeId,
          tokenEnv: READ_TOKEN_ENV,
          organizationPatTokens,
          ignore: {
            organizations: source.ignoredOrganizations
              .filter((item) => item.nodeId)
              .map((item) => item.nodeId),
            repositories: source.ignoredRepositories
              .filter((item) => item.nodeId)
              .map((item) => item.nodeId),
          },
        };
      }),
    },
    publish: {
      targets: form.publishTargets.map((target) => ({
        provider: target.provider,
        repositoryId: target.publishRepository.nodeId,
        branch: target.branch.trim(),
        path: target.path.trim(),
        tokenEnv: WRITE_TOKEN_ENV,
      })),
    },
  };
}
