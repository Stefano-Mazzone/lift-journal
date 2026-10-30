// Stage 6B2: opt-in encrypted test copy. NOT a private/isolated app mode.
// No automatic migration, local deletion, cloud writes or password recovery.
import { makeSafetyBackup } from "./cloud-sync-core.mjs";
import { isDeviceOwnedBy } from "./stage6-device-owner.mjs";
import { sealVault, openVault, storeNewVault, vaultStorageKey } from "./stage6b-vault-core.mjs";
import { captureVaultPreview, requireUnchangedVaultPreview } from "./stage6b-vault-preview-guard.mjs";

const localTest = ["localhost", "127.0.0.1"].includes(location.hostname);
const markup = [
  '<section class="lj-device-owner-panel" aria-labelledby="lj6b-title">',
  '<h3 id="lj6b-title">Stage 6B — Encrypted copy preview (test only)</h3>',
  '<p class="note"><strong>Not private yet:</strong> Your usual history is still visible after sign-out. This creates a separate encrypted COPY only; it does not migrate, replace or hide the original workouts.</p>',
  '<p id="lj6b-status" class="lj-stage5-status" role="status" aria-live="polite"></p>',
  '<div id="lj6b-create" class="stack" hidden>',
  '<button type="button" id="lj6b-backup" class="btn secondary">Download full safety backup (.json)</button>',
  '<label class="lj-owner-consent"><input type="checkbox" id="lj6b-ack" disabled><span>I verified that the backup file was saved and these fictional workouts belong to my test account.</span></label>',
  '<label for="lj6b-secret" class="input-label">Create separate encryption passphrase (minimum 12 characters)</label>',
  '<input id="lj6b-secret" class="lj-stage5-input" type="password" autocomplete="new-password" maxlength="1024">',
  '<label for="lj6b-repeat" class="input-label">Repeat encryption passphrase</label>',
  '<input id="lj6b-repeat" class="lj-stage5-input" type="password" autocomplete="new-password" maxlength="1024">',
  '<button type="button" id="lj6b-seal" class="btn" disabled>Create encrypted test copy</button>',
  '</div>',
  '<div id="lj6b-existing" class="stack" hidden>',
  '<p class="note">Encrypted copy exists for this test account. The original unencrypted workout history is unchanged.</p>',
  '<label for="lj6b-unlock-pass" class="input-label">Encryption passphrase (not account password)</label>',
  '<input id="lj6b-unlock-pass" class="lj-stage5-input" type="password" autocomplete="off" maxlength="1024">',
  '<button type="button" id="lj6b-unlock" class="btn secondary">Test unlocking encrypted copy</button>',
  '<button type="button" id="lj6b-export" class="btn secondary">Download encrypted backup (.json)</button>',
  '<p id="lj6b-result" class="note" role="status" aria-live="polite"></p>',
  '</div>',
  '<p class="note">Do not lose the separate encryption passphrase; this experimental copy has no passphrase recovery. Use fictional data only.</p>',
  '</section>'
].join("");

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function createSettingsVaultPreview({ getClient, getUser }) {
  let root = null, userId = null, snapshot = null, busy = false, sequence = 0;
  const el = id => root?.querySelector("#" + id);
  const mounted = () => localTest && root?.isConnected &&
    document.getElementById("lj6b-vault-root") === root &&
    getClient() && getUser()?.id === userId;
  const owned = () => mounted() && isDeviceOwnedBy(localStorage, userId);
  const current = (id, seq, oldRoot) =>
    sequence === seq && root === oldRoot && userId === id && owned();
  const announce = (message, kind = "info") => {
    const status = el("lj6b-status");
    if (status) { status.textContent = message; status.dataset.kind = kind; }
  };
  const reset = () => {
    sequence++;
    if (root) ["lj6b-secret", "lj6b-repeat", "lj6b-unlock-pass"].forEach(id => {
      const input = root.querySelector("#" + id);
      if (input) input.value = "";
    });
    root = null; userId = null; snapshot = null; busy = false;
  };
  function update() {
    if (!root) return;
    const allowed = owned();
    let exists = false;
    try { exists = !!userId && localStorage.getItem(vaultStorageKey(userId)) !== null; }
    catch { announce("Encrypted storage unavailable.", "error"); }
    el("lj6b-create").hidden = !allowed || exists;
    el("lj6b-existing").hidden = !allowed || !exists;
    if (!allowed) { snapshot = null; announce("PREVIEW LOCKED: this browser history belongs to a different account or is not linked."); }
    const ack = el("lj6b-ack");
    el("lj6b-backup").disabled = busy || !allowed || exists;
    ack.disabled = busy || !allowed || exists || !snapshot;
    const pass = el("lj6b-secret")?.value || "";
    el("lj6b-seal").disabled = busy || !allowed || exists || !snapshot || !ack.checked ||
      pass.length < 12 || pass !== el("lj6b-repeat")?.value;
    el("lj6b-unlock").disabled = busy || !allowed || !exists;
    el("lj6b-export").disabled = busy || !allowed || !exists;
  }
  async function verify(id, seq, oldRoot) {
    if (!current(id, seq, oldRoot)) throw Error("Account changed; operation stopped.");
    const { data: { user }, error } = await getClient().auth.getUser();
    if (error || user?.id !== id || !current(id, seq, oldRoot)) {
      throw Error("Verified test account changed or unavailable.");
    }
  }
  function backup() {
    if (busy || !owned()) return;
    try {
      const captured = captureVaultPreview(localStorage, userId);
      const data = JSON.parse(captured.raw);
      download(makeSafetyBackup(data, new Date().toISOString()),
        "lift-journal-STAGE-6B-SAFETY-" + new Date().toISOString().slice(0, 10) + ".json");
      snapshot = captured;
      el("lj6b-ack").checked = false;
      update();
      announce("Safety backup download requested. Check that the file exists before acknowledging.");
    } catch (error) {
      snapshot = null; update(); announce("Backup error: " + error.message, "error");
    }
  }
  async function seal() {
    if (busy || !owned() || !snapshot || !el("lj6b-ack")?.checked) return;
    const secret = el("lj6b-secret").value;
    if (secret.length < 12 || secret !== el("lj6b-repeat").value) return;
    const id = userId, oldRoot = root, capture = snapshot;
    try { requireUnchangedVaultPreview(localStorage, capture, id); }
    catch (error) { announce(error.message, "error"); return; }
    if (!window.confirm("CREATE ENCRYPTED TEST COPY ONLY\n\nVerified account: " +
      (getUser()?.email || "test account") + "\nWorkouts: " + capture.workoutCount +
      "\n\nYour original plaintext workouts WILL REMAIN visible in this browser. " +
      "This is NOT full account privacy or migration. Continue?")) return;
    const seq = ++sequence;
    busy = true;
    el("lj6b-secret").value = ""; el("lj6b-repeat").value = "";
    update();
    announce("Encrypting a separate copy; existing workouts are not being changed.");
    try {
      await verify(id, seq, oldRoot);
      const data = requireUnchangedVaultPreview(localStorage, capture, id);
      const encrypted = await sealVault({ userId: id, passphrase: secret, data });
      await verify(id, seq, oldRoot);
      requireUnchangedVaultPreview(localStorage, capture, id);
      const check = await openVault({ userId: id, passphrase: secret, encryptedRecord: encrypted });
      if (JSON.stringify(check) !== JSON.stringify(data)) throw Error("Encryption verification failed.");
      await verify(id, seq, oldRoot);
      requireUnchangedVaultPreview(localStorage, capture, id);
      storeNewVault(localStorage, id, encrypted); // add-only, never legacy history
      if (localStorage.getItem(vaultStorageKey(id)) !== encrypted) throw Error("Vault save verification failed.");
      snapshot = null;
      if (current(id, seq, oldRoot)) announce("Encrypted copy created and verified. Original history untouched.", "success");
    } catch (error) {
      if (current(id, seq, oldRoot)) announce("Encrypted copy stopped: " + error.message, "error");
    } finally {
      if (sequence === seq && root === oldRoot) { busy = false; update(); }
    }
  }
  async function unlock() {
    if (busy || !owned()) return;
    const secret = el("lj6b-unlock-pass").value;
    if (!secret) { announce("Enter your separate encryption passphrase.", "error"); return; }
    const id = userId, oldRoot = root, seq = ++sequence;
    const encrypted = localStorage.getItem(vaultStorageKey(id));
    if (!encrypted) { announce("No encrypted copy exists.", "error"); return; }
    busy = true; el("lj6b-unlock-pass").value = ""; update();
    try {
      await verify(id, seq, oldRoot);
      const data = await openVault({ userId: id, passphrase: secret, encryptedRecord: encrypted });
      await verify(id, seq, oldRoot);
      if (localStorage.getItem(vaultStorageKey(id)) !== encrypted) throw Error("Vault changed.");
      const count = Object.keys(data.sessions).length;
      const favorites = Array.isArray(data.favoriteMovements) ? data.favoriteMovements.length : 0;
      el("lj6b-result").textContent = "Unlocked: " + count + " workout(s), " +
        favorites + " favorite(s). No data was imported or changed.";
      announce("Encrypted copy unlocked successfully.", "success");
    } catch (error) {
      if (current(id, seq, oldRoot)) {
        el("lj6b-result").textContent = "";
        announce("Unlock stopped: " + error.message, "error");
      }
    } finally {
      if (sequence === seq && root === oldRoot) { busy = false; update(); }
    }
  }
  function exportCopy() {
    if (!owned() || busy) return;
    const encrypted = localStorage.getItem(vaultStorageKey(userId));
    if (!encrypted) return;
    download(encrypted, "lift-journal-STAGE-6B-ENCRYPTED-" +
      new Date().toISOString().slice(0, 10) + ".json");
    announce("Encrypted backup download requested. Keep your passphrase separately.", "success");
  }
  function mount() {
    const next = document.getElementById("lj6b-vault-root");
    const id = getUser()?.id || null;
    if (!localTest || !next || !id || !getClient()) { if (root) reset(); return; }
    if (next !== root || id !== userId) {
      reset(); root = next; userId = id; root.innerHTML = markup;
      root.addEventListener("click", event => {
        const button = event.target.closest?.("button");
        if (!button || button.disabled || root !== next) return;
        switch (button.id) {
          case "lj6b-backup": backup(); break;
          case "lj6b-seal": void seal(); break;
          case "lj6b-unlock": void unlock(); break;
          case "lj6b-export": exportCopy(); break;
        }
      });
      root.addEventListener("input", event => {
        if (["lj6b-secret", "lj6b-repeat"].includes(event.target.id)) update();
      });
      root.addEventListener("change", event => {
        if (event.target.id === "lj6b-ack") update();
      });
    }
    update();
  }
  return { mount, reset };
}
