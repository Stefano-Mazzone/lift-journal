// Run: node --test tests/stage5-account-panel.test.mjs
// Regression tests for Stage 5A embedded account Settings in the DRAFT app.
// No real DOM, Supabase connection or workout localStorage writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const app = read("index.html");
const source = read("stage5-account-panel.mjs");
const config = read("auth-config.js");

function panelHTML() {
  const start = app.indexOf("function stage5AccountPanel()");
  const end = app.indexOf("function settings(){", start);
  assert.ok(start >= 0 && end > start, "Settings panel helper must exist");
  return new Function(app.slice(start, end) + "\nreturn stage5AccountPanel();")();
}

function accountHarness(hostname = "127.0.0.1") {
  const ids = [
    "lj-account-panel", "lj-account-login", "lj-account-signed",
    "lj-account-status", "lj-account-email-display", "lj-account-name-display",
    "lj-account-signin", "lj-account-signout", "lj-account-open-sync"
  ];
  const elements = Object.fromEntries(ids.map(id => [id, {
    id, hidden: false, disabled: false, textContent: "", dataset: {},
    closest: selector => selector === "#lj-account-panel" ? {} : null
  }]));
  const listeners = {};
  const doc = {
    getElementById: id => elements[id] || null,
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback); }
  };
  const win = {
    LIFT_JOURNAL_AUTH: {
      url: "https://example.supabase.co",
      publishableKey: "public-test-key",
      signupEnabled: false,
      testLoginEnabled: true
    },
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback); },
    setTimeout() {}
  };
  const cleaned = source.replace(/^import \{[\s\S]*?\} from "[^"]+";\s*/gm, "")
    .replace(/renderAccount\(\);\s*void initialize\(\);\s*$/, "");
  const api = new Function("window", "document", "location",
    "const createSettingsManualSync = () => ({mount(){},reset(){}});\n" +
    "const createSettingsVaultPreview = () => ({mount(){},reset(){}});\n" +
    cleaned + "\nreturn {" +
    "renderAccount,setStatus,getState:state," +
    "setVerifiedUser:(user,name)=>{currentUser=user;displayName=name;initialized=true;}," +
    "setBusy:v=>{busy=v;initialized=true;}" +
    "};"
  )(win, doc, { hostname });
  return { api, elements, listeners };
}

test("main app and account module remain syntactically valid", () => {
  const start = app.indexOf("<script>\n(()=>{");
  const end = app.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotThrow(() => new Function(app.slice(start + "<script>".length, end)));
  assert.doesNotThrow(() => new Function(source.replace(/^import \{[\s\S]*?\} from "[^"]+";\s*/gm, "")));
});

test("panel markup is unique, accessible and part of Settings only", () => {
  const html = panelHTML();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(ids.length >= 12);
  assert.match(html, /aria-labelledby="lj-account-title"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /id="lj-account-login"/);
  assert.match(html, /id="lj-account-open-sync"/);
  assert.match(html, /href=".\/sync-preview\.html"/);
  assert.match(html, /id="lj-stage5-sync-root"/);
  assert.match(html, /id="lj-device-owner-panel"/);
  assert.match(html, /id="lj-owner-claim"/);
  assert.match(html, /id="lj-owner-ack"/);
  assert.match(html, /Signing in never automatically uploads/i);
  assert.ok(app.includes("+whatsNewPanel()+stage5AccountPanel()"));
  assert.equal(app.split("+whatsNewPanel()+stage5AccountPanel()").length, 2);
  assert.ok(app.includes("if(tab==='settings')document.dispatchEvent(new Event('lift-journal:settings-mounted'))"));
});

test("scripts load after existing app and share existing test-only auth storage", () => {
  const appEnd = app.indexOf("</script>", app.indexOf("<script>\n(()=>{"));
  assert.ok(app.indexOf('<script src="./auth-config.js"></script>') > appEnd);
  assert.ok(app.includes('<script type="module" src="./stage5-account-panel.mjs"></script>'));
  assert.ok(source.includes('const AUTH_KEY = "lift-journal-auth-test-v1";'));
  assert.ok(source.includes("client.auth.getUser()"));
  assert.ok(source.includes('import { createSettingsManualSync } from "./stage5-manual-sync.mjs";'));
  assert.ok(source.includes("embeddedSync.mount()"));
  assert.ok(source.includes('.from("profiles")'));
  assert.match(config, /signupEnabled:\s*false/);
});

test("guest and verified users see only their account controls", () => {
  const h = accountHarness();
  h.api.setStatus("Not signed in");
  assert.equal(h.elements["lj-account-login"].hidden, false);
  assert.equal(h.elements["lj-account-signed"].hidden, true);
  assert.equal(h.elements["lj-account-status"].textContent, "Not signed in");
  h.api.setVerifiedUser({ id: "test-123", email: "test@example.com" }, "Test User");
  h.api.renderAccount();
  assert.equal(h.elements["lj-account-login"].hidden, true);
  assert.equal(h.elements["lj-account-signed"].hidden, false);
  assert.equal(h.elements["lj-account-open-sync"].hidden, false);
  assert.equal(h.elements["lj-account-email-display"].textContent, "test@example.com");
  assert.equal(h.elements["lj-account-name-display"].textContent, "Test User");
  h.api.setVerifiedUser(null, "");
  h.api.renderAccount();
  assert.equal(h.elements["lj-account-login"].hidden, false);
  assert.equal(h.elements["lj-account-signed"].hidden, true);
  assert.equal(h.elements["lj-account-email-display"].textContent, "");
  assert.equal(h.elements["lj-account-name-display"].textContent, "");
  assert.ok(h.listeners["lift-journal:settings-mounted"]);
});

test("non-local host hides test login even if a user object is present", () => {
  const h = accountHarness("stefano-mazzone.github.io");
  h.api.setVerifiedUser({ id: "test", email: "test@example.com" }, "Test User");
  h.api.renderAccount();
  assert.equal(h.elements["lj-account-login"].hidden, true);
  assert.equal(h.elements["lj-account-signed"].hidden, true);
  assert.equal(h.elements["lj-account-open-sync"].hidden, true);
});

test("sign-in never auto-syncs and ownership linking requires deliberate actions", () => {
  assert.ok(!source.includes('localStorage.setItem('));
  assert.ok(!source.includes('localStorage.removeItem('));
  assert.ok(source.includes('localStorage.getItem(DEVICE_DATA_KEY)'));
  assert.ok(source.includes('makeSafetyBackup(JSON.parse(raw)'));
  assert.ok(source.includes('bindDeviceOwner('));
  assert.ok(source.includes('!($("lj-owner-ack")?.checked)'));
  assert.ok(!source.includes('window.open('));
  assert.ok(!source.includes('client.from("workouts")'));
  assert.ok(!source.includes('fetchCloudWorkouts('));
  assert.ok(!source.includes('setInterval('));
  assert.ok(app.includes("const KEY='lift-journal-v1'"));
  assert.ok(app.includes("Importing REPLACES the existing local workouts"));
  assert.ok(source.includes('scope: "local"'));
  assert.ok(source.includes('detectSessionInUrl: false'));
});
