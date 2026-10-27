// Run with: node --test tests/cloud-sync-preview-controls.test.mjs
// Regression: after comparison finishes, the eligible row created while
// busy must be re-enabled, but all already/unsupported rows stay disabled.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../cloud-sync-preview.mjs", import.meta.url), "utf8");
const start = source.indexOf("function update() {");
const end = source.indexOf("function showAccount(nextUser)");
if (start < 0 || end <= start) throw new Error("Cannot locate the Stage 4 update() function.");
const updateFunction = source.slice(start, end);

function harness() {
  const uploadEligible = { dataset: { eligible: "true" }, disabled: false };
  const downloadBlocked = { dataset: { eligible: "false" }, disabled: false };
  const elements = {};
  for (const name of ["compare", "backup", "backupCheck", "ownerCheck", "apply", "selection"]) {
    elements[name] = { disabled: false, checked: false, textContent: "" };
  }
  elements.uploadList = { querySelectorAll: () => [uploadEligible] };
  elements.downloadList = { querySelectorAll: () => [downloadBlocked] };
  const selectedUploads = new Set();
  const selectedDownloads = new Set();
  // The extracted function is evaluated against fixture UI state only; no
  // Supabase, browser, or actual workout storage access is needed.
  const controls = new Function(
    "elements", "selectedUploads", "selectedDownloads", "MAX_CHANGES",
    'let busy = true, snapshot = {}, user = { id: "test-account" }, ' +
    'backupRequested = false; const localOnly = true;\n' +
    updateFunction +
    "\nreturn { update, setBusy: v => busy = v, " +
    "setBackupRequested: v => backupRequested = v };"
  )(elements, selectedUploads, selectedDownloads, 25);
  return { controls, elements, selectedUploads, uploadEligible, downloadBlocked };
}

test("eligible workout checkbox unlocks after compare finishes", () => {
  const h = harness();
  h.controls.update();
  assert.equal(h.uploadEligible.disabled, true, "busy compare should block selection");
  h.controls.setBusy(false);
  h.controls.update();
  assert.equal(h.uploadEligible.disabled, false, "eligible upload must become selectable");
  assert.equal(h.downloadBlocked.disabled, true, "unsupported/already cloud rows remain blocked");
});

test("confirmation checkboxes and final sync button unlock in the right order", () => {
  const h = harness();
  h.controls.setBusy(false);
  h.controls.update();
  assert.equal(h.elements.ownerCheck.disabled, false, "owner confirmation can be checked after compare");
  assert.equal(h.elements.backupCheck.disabled, true, "backup acknowledgement must be locked before download");
  assert.equal(h.elements.apply.disabled, true);

  h.selectedUploads.add("lj-session:device-only-workout-001");
  h.controls.setBackupRequested(true);
  h.controls.update();
  assert.equal(h.elements.backupCheck.disabled, false);
  assert.equal(h.elements.apply.disabled, true, "selection and downloaded backup aren't sufficient");

  h.elements.backupCheck.checked = true;
  h.controls.update();
  assert.equal(h.elements.apply.disabled, true, "owner acknowledgement is still required");

  h.elements.ownerCheck.checked = true;
  h.controls.update();
  assert.equal(h.elements.apply.disabled, false, "manual sync can be explicitly confirmed now");
});
