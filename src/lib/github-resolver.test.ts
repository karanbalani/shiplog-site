import { describe, expect, test } from "bun:test";
import { fallbackCommands, parseRepository } from "./github-resolver";

describe("GitHub resolver helpers", () => {
  test("normalizes old identity commands before building fallback repository commands", () => {
    const repository = parseRepository(
      "gh api repos/bun run identity github repository SigNoz/signoz.cl.gcp.deployments --jq .node_id",
    );

    expect(repository).toBe("SigNoz/signoz.cl.gcp.deployments");
    expect(fallbackCommands("repository", repository, "GH_RW_REPO_TOKEN")).toEqual([
      "gh api repos/SigNoz/signoz.cl.gcp.deployments --jq .node_id",
    ]);
  });
});
