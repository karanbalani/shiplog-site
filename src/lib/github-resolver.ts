export type ResolveKind = "user" | "organization" | "repository";

function cleanupGitHubSubject(value: string): string {
  let normalized = value.trim().replace(/^['"]+|['"]+$/g, "");
  const identityCommandPrefix =
    /^bun\s+run\s+identity\s+github(?:\s+(?:repository|publish-target|organization-pat-token|organization|user|account))?\s+/i;

  const apiMatch = normalized.match(/api\.github\.com\/(?:users|orgs|repos)\/([^\s"'|]+)/i);
  if (apiMatch?.[1]) return apiMatch[1];

  normalized = normalized.replace(/\s*(?:--jq\b[\s\S]*|\|\s*jq\b[\s\S]*)$/i, "");
  normalized = normalized.replace(identityCommandPrefix, "");
  normalized = normalized.replace(/^gh\s+api\s+/i, "");
  normalized = normalized.replace(/^(?:users|orgs|repos)\//i, "");
  normalized = normalized.replace(identityCommandPrefix, "");

  return normalized.split(/\s+/)[0] ?? "";
}

export function normalizeGitHubInput(value: string): string {
  let normalized = cleanupGitHubSubject(value);
  normalized = normalized.replace(/^git@github\.com:/i, "");
  normalized = normalized.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  normalized = normalized.replace(/^github\.com\//i, "");
  normalized = normalized.replace(/^@/, "");
  normalized = normalized.split(/[?#]/)[0] ?? "";
  normalized = normalized.replace(/\.git$/i, "");
  return normalized.replace(/^\/+|\/+$/g, "");
}

export function parseLogin(value: string): string {
  const [login] = normalizeGitHubInput(value).split("/");
  return login ?? "";
}

export function parseRepository(value: string): string {
  const [owner, repo] = normalizeGitHubInput(value).split("/");
  if (!owner || !repo) return "";
  return `${owner}/${repo}`;
}

export function fallbackCommands(
  kind: ResolveKind,
  value: string,
  _tokenEnv = "GH_RO_CLASSIC_TOKEN",
): string[] {
  if (kind === "user") {
    const login = parseLogin(value);
    if (!login) return [];
    const path = `users/${login}`;
    return [`gh api ${path} --jq .node_id`];
  }

  if (kind === "organization") {
    const login = parseLogin(value);
    if (!login) return [];
    const path = `orgs/${login}`;
    return [`gh api ${path} --jq .node_id`];
  }

  const repository = parseRepository(value);
  if (!repository) return [];
  const path = `repos/${repository}`;
  return [`gh api ${path} --jq .node_id`];
}
