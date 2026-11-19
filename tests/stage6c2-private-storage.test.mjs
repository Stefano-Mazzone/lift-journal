// Run with: node --test tests/stage6c2-private-storage.test.mjs
// Uses fake crypto only for deterministic state-machine tests. Stage 6B crypto
// regression tests separately validate AES-GCM/PBKDF2.
import test from "node:test";
import assert from "node:assert/strict";
import { inspectCompartment, createCompartment, openCompartment,
  commitCompartment, compartmentKeys } from "../stage6c2-private-storage.mjs";
import { DEVICE_OWNER_KEY, DEVICE_DATA_KEY } from "../stage6-device-owner.mjs";
import { vaultStorageKey } from "../stage6b-vault-core.mjs";
const ID="test-user", OTHER="admin-user", DATE="2026-11-10T00:00:00.000Z";
const sourceData=()=>({unit:"kg",sessions:{"w-1":{name:"Fictional workout",month:"2026-10",day:1,started:DATE,exercises:[]}},
  favoriteMovements:["Goblet Squat"],nutrition:{goal:2000,entries:{}}});
function fakeStore() {
  const m=new Map();
  const blocked=new Set();
  return {
    m,blocked, getItem(key){return m.has(key)?m.get(key):null},
    setItem(key,value){if(blocked.has(key))throw Error("Simulated quota/write failure.");m.set(key,String(value));},
    removeItem(key){m.delete(key)}
  };
}
const encrypt=async ({userId,data})=>JSON.stringify({version:1,ownerId:userId,data});
const decrypt=async ({userId,encryptedRecord})=>{
  const v=JSON.parse(encryptedRecord);
  if(v.ownerId!==userId)throw Error("Wrong account");
  return JSON.parse(JSON.stringify(v.data));
};
const locks={async request(name,opts,fn){
  assert.match(name,/lj-stage6c2-private-v2-/);
  assert.equal(opts.mode,"exclusive");
  return fn();
}};
function setup() {
  const storage=fakeStore(),data=sourceData();
  storage.setItem(DEVICE_OWNER_KEY,JSON.stringify({version:1,userId:ID,state:"active",createdAt:DATE,updatedAt:DATE}));
  storage.setItem(DEVICE_DATA_KEY,JSON.stringify(data));
  storage.setItem(vaultStorageKey(ID),JSON.stringify({version:1,ownerId:ID,data}));
  return {storage, data, reverify:async()=>ID,
    create:(extra={})=>createCompartment({storage,userId:ID,passphrase:"fictional safe passphrase",
      encrypt,decrypt,reverify:async()=>ID,locks,...extra}),
    open:(extra={})=>openCompartment({storage,userId:ID,passphrase:"fictional safe passphrase",
      decrypt,reverify:async()=>ID,...extra})
  };
}
test("creates add-only encrypted compartment; preserves legacy and Stage 6B originals",async()=>{
  const {storage,create,open}=setup(),old=storage.getItem(DEVICE_DATA_KEY),
    original=storage.getItem(vaultStorageKey(ID));
  const saved=await create();
  assert.equal(saved.revision,1);
  assert.equal(saved.workouts,1);
  assert.equal(saved.favorites,1);
  assert.equal(storage.getItem(DEVICE_DATA_KEY),old);
  assert.equal(storage.getItem(vaultStorageKey(ID)),original);
  const reopened=await open();
  assert.equal(reopened.revision,1);
  assert.deepEqual(reopened.data.favoriteMovements,["Goblet Squat"]);
  assert.equal(inspectCompartment(storage,ID).exists,true);
});
test("two write slots preserve older committed record and reopen latest save",async()=>{
  const {storage,create,open}=setup();
  await create();
  const earlier=await open();
  const data=structuredClone(earlier.data);
  data.favoriteMovements.push("TEST - new favorite");
  const saved=await commitCompartment({storage,userId:ID,passphrase:"fictional safe passphrase",
    data,expectedData:earlier.data,expectedHeadRaw:earlier.headRaw,encrypt,decrypt,reverify:async()=>ID,locks});
  assert.equal(saved.revision,2);
  assert.equal(JSON.parse(storage.getItem(compartmentKeys(ID).slots[0])).revision,1);
  const result=await open();
  assert.equal(result.revision,2);
  assert.deepEqual(result.data.favoriteMovements,["Goblet Squat","TEST - new favorite"]);
});
test("stale tab save is rejected and cannot overwrite a newer revision",async()=>{
  const {storage,create,open}=setup();
  await create();
  const old=await open();
  const data=structuredClone(old.data);
  data.favoriteMovements.push("save1");
  await commitCompartment({storage,userId:ID,passphrase:"fictional safe passphrase",
    data,expectedData:old.data,expectedHeadRaw:old.headRaw,encrypt,decrypt,reverify:async()=>ID,locks});
  const newHead=storage.getItem(compartmentKeys(ID).head);
  await assert.rejects(()=>commitCompartment({storage,userId:ID,
    passphrase:"fictional safe passphrase",data,expectedData:old.data,expectedHeadRaw:old.headRaw,
    encrypt,decrypt,reverify:async()=>ID,locks}),/changed in another tab/);
  assert.equal(storage.getItem(compartmentKeys(ID).head),newHead);
});
test("failed inactive-slot write keeps last committed head and content",async()=>{
  const {storage,create,open}=setup();
  await create();
  const old=await open();
  const keys=compartmentKeys(ID),active=storage.getItem(keys.slots[0]);
  const data=structuredClone(old.data);data.favoriteMovements.push("will not save");
  storage.blocked.add(keys.slots[1]);
  await assert.rejects(()=>commitCompartment({storage,userId:ID,
    passphrase:"fictional safe passphrase",data,expectedData:old.data,expectedHeadRaw:old.headRaw,
    encrypt,decrypt,reverify:async()=>ID,locks}),/Simulated quota/);
  assert.equal(storage.getItem(keys.head),old.headRaw);
  assert.equal(storage.getItem(keys.slots[0]),active);
  assert.deepEqual((await open()).data,old.data);
});
test("failed head write keeps prior valid head without modifying active slot",async()=>{
  const {storage,create,open}=setup();
  await create();
  const old=await open(),keys=compartmentKeys(ID);
  const currentSlot=storage.getItem(keys.slots[0]);
  const data=structuredClone(old.data);data.favoriteMovements.push("orphan uncommitted");
  storage.blocked.add(keys.head);
  await assert.rejects(()=>commitCompartment({storage,userId:ID,
    passphrase:"fictional safe passphrase",data,expectedData:old.data,expectedHeadRaw:old.headRaw,
    encrypt,decrypt,reverify:async()=>ID,locks}),/Simulated quota/);
  assert.equal(storage.getItem(keys.head),old.headRaw);
  assert.equal(storage.getItem(keys.slots[0]),currentSlot);
  assert.deepEqual((await open()).data,old.data);
});
test("owner mismatch or failed server account verification refuses reads and writes",async()=>{
  const {storage,create,open}=setup();
  await create();
  const head=storage.getItem(compartmentKeys(ID).head);
  await assert.rejects(()=>open({userId:OTHER}),/PRIVATE STORAGE LOCKED/);
  await assert.rejects(()=>open({reverify:async()=>OTHER}),/Current account/);
  const prior=await open();
  await assert.rejects(()=>commitCompartment({storage,userId:ID,
    passphrase:"fictional safe passphrase",data:prior.data,expectedData:prior.data,expectedHeadRaw:head,
    encrypt,decrypt,reverify:async()=>OTHER,locks}),/Current account/);
  assert.equal(storage.getItem(compartmentKeys(ID).head),head);
});
test("fails closed when storage was partially created; never overwrites an orphan slot",async()=>{
  const {storage,create}=setup(),keys=compartmentKeys(ID);
  storage.setItem(keys.slots[0],"incomplete");
  assert.throws(()=>inspectCompartment(storage,ID),/Incomplete private storage/);
  await assert.rejects(()=>create(),/Incomplete private storage/);
  assert.equal(storage.getItem(keys.slots[0]),"incomplete");
  assert.equal(storage.getItem(keys.head),null);
});
test("damaged head or active slot does not silently roll back to another revision",async()=>{
  const {storage,create,open}=setup();
  await create();
  const keys=compartmentKeys(ID);
  storage.setItem(keys.slots[0],"{corrupt");
  assert.throws(()=>inspectCompartment(storage,ID),/damaged/);
  await assert.rejects(()=>open(),/damaged/);
});
test("refuses save without Web Locks support; no opportunistic unsafe fallback",async()=>{
  const {storage,create,open}=setup();
  await create();
  const old=await open();
  await assert.rejects(()=>commitCompartment({storage,userId:ID,
    passphrase:"fictional safe passphrase",data:old.data,expectedData:old.data,expectedHeadRaw:old.headRaw,
    encrypt,decrypt,reverify:async()=>ID,locks:null}),/Exclusive browser storage locks/);
  assert.equal(storage.getItem(compartmentKeys(ID).head),old.headRaw);
});
test("rejects an existing compartment instead of overwriting it during creation",async()=>{
  const {storage,create}=setup();
  await create();
  const saved=storage.getItem(compartmentKeys(ID).head);
  await assert.rejects(()=>create(),/already exists/);
  assert.equal(storage.getItem(compartmentKeys(ID).head),saved);
});
test("source backup mutation during expensive encryption blocks creating the compartment",async()=>{
  const {storage,create}=setup();
  const original=storage.getItem(vaultStorageKey(ID));
  const altered=async args=>{
    storage.setItem(vaultStorageKey(ID),JSON.stringify({...JSON.parse(original),changed:true}));
    return encrypt(args);
  };
  await assert.rejects(()=>create({encrypt:altered}),/Original local history or encrypted copy changed/);
  assert.equal(storage.getItem(compartmentKeys(ID).head),null);
});

test("mistyped save passphrase cannot replace a previously readable encrypted revision",async()=>{
  const {storage,create,open}=setup();
  await create();
  const current=await open(),keys=compartmentKeys(ID);
  const oldHead=storage.getItem(keys.head);
  const oldSlot=storage.getItem(keys.slots[0]);
  const data=structuredClone(current.data);
  data.favoriteMovements.push("should never save");
  const rejectWrongPassword=async args=>{
    if(args.passphrase!=="fictional safe passphrase")
      throw Error("Current encrypted copy could not be unlocked with that passphrase.");
    return decrypt(args);
  };
  await assert.rejects(()=>commitCompartment({storage,userId:ID,
    passphrase:"mistyped passphrase",data,expectedData:current.data,
    expectedHeadRaw:current.headRaw,encrypt,decrypt:rejectWrongPassword,
    reverify:async()=>ID,locks}),/could not be unlocked/);
  assert.equal(storage.getItem(keys.head),oldHead);
  assert.equal(storage.getItem(keys.slots[0]),oldSlot);
  assert.equal(storage.getItem(keys.slots[1]),null);
});
test("does not save when the decrypted starting data has changed without a new unlock",async()=>{
  const {storage,create,open}=setup();
  await create();
  const current=await open(),keys=compartmentKeys(ID),head=storage.getItem(keys.head);
  const wrongStartingData={...current.data,favoriteMovements:["different"]};
  await assert.rejects(()=>commitCompartment({storage,userId:ID,
    passphrase:"fictional safe passphrase",data:current.data,
    expectedData:wrongStartingData,expectedHeadRaw:current.headRaw,
    encrypt,decrypt,reverify:async()=>ID,locks}),/unlocked starting data differs/);
  assert.equal(storage.getItem(keys.head),head);
});
