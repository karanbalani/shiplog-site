import type {
  BuilderForm,
  CollectSource,
  PublishTarget,
  ResolveItem,
  ResolveListKey,
} from "./config-builder-model";

export type BuilderValidationTab = "profile" | "collection" | "publish";
export type BuilderValidationStatus = "valid" | "invalid";

export type BuilderValidation = {
  ready: boolean;
  tabs: Record<BuilderValidationTab, BuilderValidationStatus>;
  profile: {
    displayName?: string;
    lookbackDays?: string;
  };
  sources: Record<
    string,
    {
      account?: string;
      restrictedOrganizations: Record<string, string>;
      ignoredOrganizations: Record<string, string>;
      ignoredRepositories: Record<string, string>;
    }
  >;
  publishTargets: Record<
    string,
    {
      publishRepository?: string;
      branch?: string;
      path?: string;
    }
  >;
};

const tabOrder: BuilderValidationTab[] = ["profile", "collection", "publish"];

function requiredResolverError(
  item: ResolveItem,
  emptyMessage: string,
  unresolvedMessage: string,
): string | undefined {
  if (!item.nodeId) {
    if (!item.value.trim()) return emptyMessage;
    return item.status === "error" ? item.message || unresolvedMessage : unresolvedMessage;
  }

  return undefined;
}

function optionalResolverError(item: ResolveItem): string | undefined {
  if (!item.value.trim() || item.nodeId) return undefined;
  if (item.status === "error") return item.message || "Resolve this entry.";
  return "Resolve this entry.";
}

function collectListErrors(source: CollectSource, key: ResolveListKey): Record<string, string> {
  return Object.fromEntries(
    source[key].flatMap((item) => {
      const error = optionalResolverError(item);
      return error ? [[item.id, error]] : [];
    }),
  );
}

function hasValues(record: Record<string, string>): boolean {
  return Object.keys(record).length > 0;
}

function sourceHasErrors(source: BuilderValidation["sources"][string]): boolean {
  return Boolean(
    source.account ||
    hasValues(source.restrictedOrganizations) ||
    hasValues(source.ignoredOrganizations) ||
    hasValues(source.ignoredRepositories),
  );
}

function publishTargetHasErrors(target: BuilderValidation["publishTargets"][string]): boolean {
  return Boolean(target.publishRepository || target.branch || target.path);
}

function duplicateSourceAccountIds(sources: CollectSource[]): Set<string> {
  const counts = new Map<string, number>();

  for (const source of sources) {
    const accountId = source.account.nodeId.trim();
    if (!accountId) continue;
    counts.set(accountId, (counts.get(accountId) ?? 0) + 1);
  }

  return new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([accountId]) => accountId),
  );
}

function duplicatePublishRepositoryIds(targets: PublishTarget[]): Set<string> {
  const counts = new Map<string, number>();

  for (const target of targets) {
    const repositoryId = target.publishRepository.nodeId.trim();
    if (!repositoryId) continue;
    counts.set(repositoryId, (counts.get(repositoryId) ?? 0) + 1);
  }

  return new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([repositoryId]) => repositoryId),
  );
}

function validateSource(
  source: CollectSource,
  duplicateAccountIds: Set<string>,
): BuilderValidation["sources"][string] {
  const accountResolverError = requiredResolverError(
    source.account,
    "Enter and resolve a GitHub username.",
    "Resolve this GitHub username.",
  );
  const duplicateAccountError =
    source.account.nodeId && duplicateAccountIds.has(source.account.nodeId.trim())
      ? "This GitHub account is already added."
      : undefined;

  return {
    account: accountResolverError ?? duplicateAccountError,
    restrictedOrganizations: collectListErrors(source, "restrictedOrganizations"),
    ignoredOrganizations: collectListErrors(source, "ignoredOrganizations"),
    ignoredRepositories: collectListErrors(source, "ignoredRepositories"),
  };
}

function validatePublishTarget(
  target: PublishTarget,
  duplicateRepositoryIds: Set<string>,
): BuilderValidation["publishTargets"][string] {
  const publishRepositoryError = requiredResolverError(
    target.publishRepository,
    "Enter and resolve a publish repository.",
    "Resolve this publish repository.",
  );
  const duplicateRepositoryError =
    target.publishRepository.nodeId &&
    duplicateRepositoryIds.has(target.publishRepository.nodeId.trim())
      ? "This publish repository is already added."
      : undefined;

  return {
    publishRepository: publishRepositoryError ?? duplicateRepositoryError,
    branch: target.branch.trim() ? undefined : "Enter a publish branch.",
    path: target.path.trim() ? undefined : "Enter a publish path.",
  };
}

export function validateBuilderForm(form: BuilderForm): BuilderValidation {
  const profile = {
    displayName: form.displayName.trim() ? undefined : "Enter a display name.",
    lookbackDays:
      Number.isInteger(form.lookbackDays) && form.lookbackDays >= 0 && form.lookbackDays <= 90
        ? undefined
        : "Use 0 to 90 days.",
  };

  const duplicateAccountIds = duplicateSourceAccountIds(form.sources);
  const sources = Object.fromEntries(
    form.sources.map((source) => [source.id, validateSource(source, duplicateAccountIds)]),
  );
  const duplicateRepositoryIds = duplicatePublishRepositoryIds(form.publishTargets);
  const publishTargets = Object.fromEntries(
    form.publishTargets.map((target) => [
      target.id,
      validatePublishTarget(target, duplicateRepositoryIds),
    ]),
  );

  const tabs = {
    profile: profile.displayName || profile.lookbackDays ? "invalid" : "valid",
    collection: Object.values(sources).some(sourceHasErrors) ? "invalid" : "valid",
    publish: Object.values(publishTargets).some(publishTargetHasErrors) ? "invalid" : "valid",
  } satisfies BuilderValidation["tabs"];

  return {
    ready: Object.values(tabs).every((status) => status === "valid"),
    tabs,
    profile,
    sources,
    publishTargets,
  };
}

export function firstInvalidBuilderTab(validation: Pick<BuilderValidation, "tabs">) {
  return tabOrder.find((tab) => validation.tabs[tab] === "invalid") ?? tabOrder[0];
}
