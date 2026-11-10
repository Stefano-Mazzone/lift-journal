// Run with: node --test tests/cloud-sync-preview-controls.test.mjs
// Stage 4 checkout gates and selection regression tests; no real browser data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../cloud-sync-preview.mjs", import.meta.url), "utf8");
const start = source.indexOf("function update() {");
const end = source.indexOf("function showAccount(nextUser)");
const buttonStart = source.indexOf('selectMissingCloudButton.addEventListener("click", () => {');
const buttonEnd = source.indexOf("function browserSave(json, filename)");
if ([start, end, buttonStart, buttonEnd].some(n => n < 0) || end <= start || buttonEnd <= buttonStart) {
  throw new Error("Could not find Stage 4 control functions.");
}
const updateFunction = source.slice(start, end);
const selectButtonHandler = source.slice(buttonStart, buttonEnd);

function harness({ linked = true } = {}) {
  const existing = "lj-session:device-only-workout-001";
  const missing = "lj-session:stage1-fixture-workout-001";
  const uploadEligible = { dataset: { eligible: "true", workoutId: existing }, disabled: false, checked: false };
  const downloadEligible = { dataset: { eligible: "true", workoutId: missing }, disabled: false, checked: false };
  const downloadBlocked = { dataset: { eligible: "false", workoutId: existing }, disabled: false, checked: false };
  const elements = {};
  for (const name of ["compare", "backup", "backupCheck", "ownerCheck", "apply", "selection"]) {
    elements[name] = { disabled: false, checked: false, textContent: "" };
  }
  elements.uploadList = { querySelectorAll: () => [uploadEligible] };
  elements.downloadList = { querySelectorAll: () => [downloadEligible, downloadBlocked] };
  const selectedCloudButton = {
    disabled: true, addEventListener(event, handler) {
      assert.equal(event, "click");
      this.press = handler;
    }
  };
  const selectedUploads = new Set();
  const selectedDownloads = new Set();
  const messages = [];
  const announce = message => messages.push(message);

  const controls = new Function(
    "elements", "selectedUploads", "selectedDownloads", "MAX_CHANGES",
    "selectMissingCloudButton", "announce", "ownerLinked",
    'let busy = true, snapshot = { ownerId: "test-account", ' +
    'plan: { download: [{ id: "lj-session:stage1-fixture-workout-001", status: "eligible" }, ' +
    '{ id: "lj-session:device-only-workout-001", status: "already" }] } }, ' +
    'user = { id: "test-account" }, backupRequested = false; const localOnly = true;\n' +
    updateFunction + "\n" + selectButtonHandler +
    "\nreturn { update, setBusy: v => busy = v, " +
    "setBackupRequested: v => backupRequested = v };"
  )(elements, selectedUploads, selectedDownloads, 25, selectedCloudButton, announce, () => linked);
  return {
    controls, elements, selectedUploads, selectedDownloads,
    uploadEligible, downloadEligible, downloadBlocked, selectedCloudButton, messages
  };
}

test("both eligible upload and download controls unlock after compare", () => {
  const h = harness();
  h.controls.update();
  assert.equal(h.uploadEligible.disabled, true, "comparison ongoing blocks selection");
  assert.equal(h.downloadEligible.disabled, true);
  assert.equal(h.selectedCloudButton.disabled, true);
  h.controls.setBusy(false);
  h.controls.update();
  assert.equal(h.uploadEligible.disabled, false, "eligible upload unlocks");
  assert.equal(h.downloadEligible.disabled, false, "eligible download unlocks");
  assert.equal(h.downloadBlocked.disabled, true, "existing item remains disabled");
  assert.equal(h.selectedCloudButton.disabled, false, "alternate select action unlocks");
});

test("one-click missing cloud selection chooses eligible only, without syncing", () => {
  const h = harness();
  h.controls.setBusy(false);
  h.controls.update();
  h.selectedCloudButton.press();
  assert.deepEqual([...h.selectedDownloads], ["lj-session:stage1-fixture-workout-001"]);
  assert.equal(h.downloadEligible.checked, true);
  assert.equal(h.downloadBlocked.checked, false);
  assert.equal(h.elements.apply.disabled, true, "sync still requires backup plus owner confirmation");
  assert.match(h.messages.at(-1), /No data has been changed/);
});

test("confirmation checkboxes and final sync button unlock in the right order", () => {
  const h = harness();
  h.controls.setBusy(false);
  h.controls.update();
  assert.equal(h.elements.ownerCheck.disabled, false);
  assert.equal(h.elements.backupCheck.disabled, true);
  assert.equal(h.elements.apply.disabled, true);
  h.selectedUploads.add("lj-session:device-only-workout-001");
  h.controls.setBackupRequested(true);
  h.controls.update();
  assert.equal(h.elements.backupCheck.disabled, false);
  assert.equal(h.elements.apply.disabled, true);
  h.elements.backupCheck.checked = true;
  h.controls.update();
  assert.equal(h.elements.apply.disabled, true, "account ownership still required");
  h.elements.ownerCheck.checked = true;
  h.controls.update();
  assert.equal(h.elements.apply.disabled, false, "both consent steps and a selection unlock sync");
});


test("standalone fallback stays locked when this browser isn't linked to current account", () => {
  const h = harness({ linked: false });
  h.controls.setBusy(false);
  h.controls.update();
  assert.equal(h.elements.compare.disabled, true);
  assert.equal(h.uploadEligible.disabled, true);
  assert.equal(h.downloadEligible.disabled, true);
  assert.equal(h.selectedCloudButton.disabled, true);
  h.selectedUploads.add("lj-session:device-only-workout-001");
  h.controls.setBackupRequested(true);
  h.elements.backupCheck.checked = true;
  h.elements.ownerCheck.checked = true;
  h.controls.update();
  assert.equal(h.elements.apply.disabled, true, "ownership gate cannot be bypassed by consent boxes");
});
