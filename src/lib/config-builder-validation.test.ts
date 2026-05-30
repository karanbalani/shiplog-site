import { expect, test } from "bun:test";
import { createInitialBuilderForm, createItem, createPublishTarget } from "./config-builder-model";
import { firstInvalidBuilderTab, validateBuilderForm } from "./config-builder-validation";

test("starts users on the first invalid tab", () => {
  const validation = validateBuilderForm(createInitialBuilderForm());

  expect(firstInvalidBuilderTab(validation)).toBe("profile");
});

test("marks empty required resolver fields on their tabs", () => {
  const validation = validateBuilderForm(createInitialBuilderForm());

  expect(validation.ready).toBe(false);
  expect(validation.tabs).toEqual({
    profile: "invalid",
    collection: "invalid",
    publish: "invalid",
  });
  expect(validation.profile.displayName).toBe("Enter a display name.");
  expect(validation.sources["source-github-1"]?.account).toBe(
    "Enter and resolve a GitHub username.",
  );
  expect(validation.publishTargets["publish-target-github-1"]?.publishRepository).toBe(
    "Enter and resolve a publish repository.",
  );
});

test("marks typed optional resolver rows until they are resolved", () => {
  const form = createInitialBuilderForm();
  const source = form.sources[0];
  source.account.nodeId = "U_octocat";
  source.account.status = "resolved";
  source.account.value = "octocat";
  source.ignoredRepositories = [
    {
      ...createItem("ignored-repo-1", "SigNoz/signoz"),
      status: "error",
      message: "not found or private",
    },
  ];

  const publishTarget = form.publishTargets[0];
  publishTarget.publishRepository.nodeId = "R_shiplog";
  publishTarget.publishRepository.status = "resolved";
  publishTarget.publishRepository.value = "karanbalani/shiplog";

  const validation = validateBuilderForm(form);

  expect(validation.ready).toBe(false);
  expect(validation.tabs.collection).toBe("invalid");
  expect(validation.sources["source-github-1"]?.ignoredRepositories["ignored-repo-1"]).toBe(
    "not found or private",
  );
});

test("marks profile and publish text fields invalid when schema-required values are empty", () => {
  const form = createInitialBuilderForm();
  form.displayName = " ";
  form.lookbackDays = 91;
  const target = createPublishTarget("publish-target-2");
  target.publishRepository.nodeId = "R_shiplog";
  target.publishRepository.status = "resolved";
  target.branch = "";
  target.path = "";
  form.publishTargets = [target];
  form.sources[0].account.nodeId = "U_octocat";
  form.sources[0].account.status = "resolved";

  const validation = validateBuilderForm(form);

  expect(validation.tabs.profile).toBe("invalid");
  expect(validation.tabs.publish).toBe("invalid");
  expect(validation.profile.displayName).toBe("Enter a display name.");
  expect(validation.profile.lookbackDays).toBe("Use 0 to 90 days.");
  expect(validation.publishTargets["publish-target-2"]?.branch).toBe("Enter a publish branch.");
  expect(validation.publishTargets["publish-target-2"]?.path).toBe("Enter a publish path.");
});
