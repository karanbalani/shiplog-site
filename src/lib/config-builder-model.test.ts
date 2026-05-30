import { expect, test } from "bun:test";
import { buildConfig, createInitialBuilderForm, createPublishTarget } from "./config-builder-model";

test("starts with an empty display name", () => {
  expect(createInitialBuilderForm().displayName).toBe("");
});

test("builds every publish target in order", () => {
  const firstTarget = createPublishTarget("publish-target-1");
  firstTarget.publishRepository.nodeId = "R_PROFILE_1";
  firstTarget.branch = "main";
  firstTarget.path = "README.md";

  const secondTarget = createPublishTarget("publish-target-2");
  secondTarget.publishRepository.nodeId = "R_DOCS_2";
  secondTarget.branch = "docs";
  secondTarget.path = "profile/README.md";

  const form = {
    ...createInitialBuilderForm(),
    publishTargets: [firstTarget, secondTarget],
  };

  expect(buildConfig(form).publish.targets).toEqual([
    {
      provider: "github",
      repositoryId: "R_PROFILE_1",
      branch: "main",
      path: "README.md",
      tokenEnv: "GH_RW_REPO_TOKEN",
    },
    {
      provider: "github",
      repositoryId: "R_DOCS_2",
      branch: "docs",
      path: "profile/README.md",
      tokenEnv: "GH_RW_REPO_TOKEN",
    },
  ]);
});
