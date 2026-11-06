// F4 spike: ENSv2 on Sepolia. The publisher wallet (standing in for an app team) registers a name
// with its own PermissionedResolver and lets the indexer wallet set ONLY the "hydra.status" text
// record. The indexer writes it; anyone reads it back. Each finished step is saved to state.json
// (tx hashes, no secrets) so a rerun skips it and never resends a write.
// Run: node --env-file=../../.env spike.mjs <label> [status] [--sub]
// --sub: the status lives on status.<label>.eth, a subname in the team's own sub-registry.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData, keccak256, toHex, parseEther, parseEventLogs, zeroAddress, zeroHash } from "../../apps/api/node_modules/viem/_esm/index.js";
import { privateKeyToAccount } from "../../apps/api/node_modules/viem/_esm/accounts/index.js";
import { sepolia } from "../../apps/api/node_modules/viem/_esm/chains/index.js";
import { packetToBytes } from "../../apps/api/node_modules/viem/_esm/utils/ens/packetToBytes.js";

const abi = (n) => JSON.parse(readFileSync(new URL(`./abi/${n}.json`, import.meta.url))).abi;
const A = {
  registrar: "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3",
  resolverImpl: "0x115eb53f0c60696633855f90b138178fb40b2b2c",
  factory: "0xda70306c98e97ece36f997a21368e53298572991",
  usdc: "0x240b0316df57887dbbe58b586508b19e633a14aa",
  universal: "0x24e1d8e068620b647ca097f961a61055f4f42d72",
  ethRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
  userRegistryImpl: "0x9bd8a88719068d09ecee662f36c0e3856708366a",
};
const KEY = "hydra.status";
const ALL_ROLES = BigInt("0x" + "11".repeat(32));

const SUB = process.argv.includes("--sub");
const args_ = process.argv.slice(2).filter((a) => a !== "--sub");
const label = args_[0] || "hydrastatus";
const name = SUB ? `status.${label}.eth` : `${label}.eth`;
const dns = toHex(packetToBytes(name));
const STATE = new URL(label === "hydrastatus" ? "./state.json" : `./state-${label}.json`, import.meta.url);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE)) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");

const transport = http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 30_000, retryCount: 0 });
const pub = createPublicClient({ chain: sepolia, transport });
const owner = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY) });
const indexer = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(process.env.ARKIV_INDEXER_PRIVATE_KEY) });
console.log(`name ${name}, owner ${owner.account.address}, indexer ${indexer.account.address}`);

// One write, waited for; its hash is saved under `step` before waiting, so a crash never resends it.
async function once(step, send) {
  if (state[step]) return console.log(`skip ${step} (${state[step]})`);
  const hash = await send();
  state[step] = hash;
  save();
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`${step} reverted: https://sepolia.etherscan.io/tx/${hash}`);
  console.log(`ok ${step} https://sepolia.etherscan.io/tx/${hash}`);
  return r;
}

if ((await pub.getBalance({ address: owner.account.address })) < parseEther("0.01")) {
  await once("fundOwner", () => indexer.sendTransaction({ to: owner.account.address, value: parseEther("0.2") }));
}

// 1. The team's own resolver, all roles to the team.
if (!state.resolver) {
  const salt = BigInt(keccak256(toHex(`hydra-spike-${label}-${owner.account.address}`)));
  const data = encodeFunctionData({ abi: abi("PermissionedResolver"), functionName: "initialize", args: [[{ account: owner.account.address, roleBitmap: ALL_ROLES }], []] });
  const r = await once("deployResolver", () => owner.writeContract({ address: A.factory, abi: abi("VerifiableFactory"), functionName: "deployProxy", args: [A.resolverImpl, salt, data] }));
  state.resolver = parseEventLogs({ abi: abi("VerifiableFactory"), logs: r.logs, eventName: "ProxyDeployed" })[0].args.proxyAddress;
  save();
}
console.log(`resolver ${state.resolver}`);

// 2. Register the name, pointing at that resolver. Fee in MockUSDC (public mint).
const reg = abi("ETHRegistrar");
const duration = await pub.readContract({ address: A.registrar, abi: reg, functionName: "MIN_REGISTER_DURATION" });
if (!state.register) {
  const [base, premium] = await pub.readContract({ address: A.registrar, abi: reg, functionName: "getRegisterPrice", args: [label, duration, A.usdc] });
  await once("mintUsdc", () => owner.writeContract({ address: A.usdc, abi: abi("MockUSDC"), functionName: "mint", args: [owner.account.address, (base + premium) * 2n] }));
  await once("approveUsdc", () => owner.writeContract({ address: A.usdc, abi: abi("MockUSDC"), functionName: "approve", args: [A.registrar, (base + premium) * 2n] }));
  state.secret ??= keccak256(toHex(`secret-${label}-${Date.now()}`));
  save();
  const args = [label, owner.account.address, state.secret, zeroAddress, state.resolver, duration, zeroHash];
  const commitment = await pub.readContract({ address: A.registrar, abi: reg, functionName: "makeCommitment", args });
  await once("commit", () => owner.writeContract({ address: A.registrar, abi: reg, functionName: "commit", args: [commitment] }));
  const wait = Number(await pub.readContract({ address: A.registrar, abi: reg, functionName: "MIN_COMMITMENT_AGE" })) + 5;
  console.log(`waiting ${wait} s for the commitment`);
  await new Promise((r) => setTimeout(r, wait * 1000));
  await once("register", () => owner.writeContract({ address: A.registrar, abi: reg, functionName: "register", args: [label, owner.account.address, state.secret, zeroAddress, state.resolver, duration, A.usdc, zeroHash] }));
}

// 2b. The team's own sub-registry under <label>.eth, then status.<label>.eth in it.
if (SUB) {
  const ur = abi("UserRegistry");
  if (!state.subregistry) {
    const salt = BigInt(keccak256(toHex(`hydra-spike-sub-${label}-${owner.account.address}`)));
    const data = encodeFunctionData({ abi: ur, functionName: "initialize", args: [[{ account: owner.account.address, roleBitmap: ALL_ROLES }]] });
    const r = await once("deploySubregistry", () => owner.writeContract({ address: A.factory, abi: abi("VerifiableFactory"), functionName: "deployProxy", args: [A.userRegistryImpl, salt, data] }));
    state.subregistry = parseEventLogs({ abi: abi("VerifiableFactory"), logs: r.logs, eventName: "ProxyDeployed" })[0].args.proxyAddress;
    save();
  }
  console.log(`subregistry ${state.subregistry}`);
  const parentId = BigInt(keccak256(toHex(label)));
  await once("setSubregistry", () => owner.writeContract({ address: A.ethRegistry, abi: abi("ETHRegistry"), functionName: "setSubregistry", args: [parentId, state.subregistry] }));
  const expiry = await pub.readContract({ address: A.ethRegistry, abi: abi("ETHRegistry"), functionName: "getExpiry", args: [parentId] });
  await once("registerStatus", () => owner.writeContract({ address: state.subregistry, abi: ur, functionName: "register", args: ["status", owner.account.address, zeroAddress, state.resolver, ALL_ROLES, expiry] }));
}

// 3. Grant the indexer ONLY setText for "hydra.status".
const res = abi("PermissionedResolver");
const setter = encodeFunctionData({ abi: res, functionName: "setText", args: ["0x", KEY, ""] });
await once("grantStatusOnly", () => owner.writeContract({ address: state.resolver, abi: res, functionName: "grantSetterRoles", args: [setter, indexer.account.address] }));

// 4. The indexer writes the status; a different key must be refused.
const value = args_[1] || "match";
await once(`setStatus-${value}-${Date.now()}`, () => indexer.writeContract({ address: state.resolver, abi: res, functionName: "setText", args: [dns, KEY, value] }));
try {
  await pub.simulateContract({ account: indexer.account, address: state.resolver, abi: res, functionName: "setText", args: [dns, "url", "https://evil.example"] });
  console.log("UNEXPECTED: the indexer may set another key");
} catch (e) {
  console.log(`ok indexer refused for key "url" (${e.shortMessage ?? e.message})`.slice(0, 200));
}

// 5. Anyone reads it through the ENSv2 Universal Resolver.
const read = await pub.getEnsText({ name, key: KEY, universalResolverAddress: A.universal });
console.log(`read ${name} ${KEY} = ${read}`);
