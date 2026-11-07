// Shared ENS helpers for the explorer. ENSv2 on Sepolia, read in the browser through the Universal
// Resolver contract; Hydra's server is not asked. Text records are data: shown, never run.
import { createPublicClient, createWalletClient, custom, http, parseAbi, toHex, zeroAddress } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";
import { sepolia } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/chains/+esm";
import { normalize, packetToBytes } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/ens/+esm";

export { sepolia, zeroAddress };
export const KEYS = { status: "hydra.status", app: "hydra.app", release: "hydra.release" };
// ENSv2 Sepolia deployment: contract addresses.
export const ENS = {
  universal: "0x24e1d8e068620b647ca097f961a61055f4f42d72",
  registrar: "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3",
  resolverImpl: "0x115eb53f0c60696633855f90b138178fb40b2b2c",
  factory: "0xda70306c98e97ece36f997a21368e53298572991",
  usdc: "0x240b0316df57887dbbe58b586508b19e633a14aa",
};
// Hydra's indexer wallet, the only writer of hydra.status (same as INDEXER in arkiv.js).
export const HYDRA_WRITER = "0xc4e52D70880a83331E1cCd0AD745059D12565ea9";
export const ALL_ROLES = BigInt("0x" + "11".repeat(32));

export const ABI = {
  resolver: parseAbi([
    "function initialize((address account,uint256 roleBitmap)[] grants,bytes[] calls)",
    "function multicall(bytes[] calls) returns (bytes[])",
    "function grantSetterRoles(bytes setter,address account) returns (bool)",
    "function setText(bytes name,string key,string value)",
  ]),
  factory: parseAbi([
    "function deployProxy(address implementation,uint256 salt,bytes data) returns (address)",
    "function predictProxyAddress(address deployer,uint256 salt) view returns (address)",
  ]),
  registrar: parseAbi([
    "function MIN_COMMITMENT_AGE() view returns (uint64)",
    "function MIN_REGISTER_DURATION() view returns (uint64)",
    "function isAvailable(string label) view returns (bool)",
    "function getRegisterPrice(string label,uint64 duration,address paymentToken) view returns (uint256,uint256)",
    "function makeCommitment(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,bytes32 referrer) pure returns (bytes32)",
    "function commit(bytes32 commitment)",
    "function register(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,address paymentToken,bytes32 referrer) returns (uint256)",
  ]),
  usdc: parseAbi(["function mint(address to,uint256 amount)", "function approve(address spender,uint256 value) returns (bool)"]),
};

export const client = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
export const dnsName = (name) => toHex(packetToBytes(name));
export const NAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const tx = (hash) => `https://sepolia.etherscan.io/tx/${hash}`;

// The name's resolver, or null when the name has none (not registered on ENSv2 Sepolia).
export async function resolverOf(name) {
  const r = await client.getEnsResolver({ name: normalize(name), universalResolverAddress: ENS.universal });
  return r && r !== zeroAddress ? r : null;
}

// ENS, read. Reads one text record (for example "hydra.status") straight from ENS on Sepolia, in the
// visitor's browser, through ENSv2's UniversalResolver contract (viem getEnsText). No Hydra server or
// API is involved, so the verdict can be checked without trusting Hydra's backend. Used by the /status/
// pages and the app page. Returns "" when the record is not set.
export async function text(name, key) {
  return (await client.getEnsText({ name: normalize(name), key, universalResolverAddress: ENS.universal })) ?? "";
}

// hydra.status, hydra.app and hydra.release of a name, read in parallel.
export async function hydraRecords(name) {
  const [status, app, release] = await Promise.all([text(name, KEYS.status), text(name, KEYS.app), text(name, KEYS.release)]);
  return { status, app, release };
}

// A wallet client on Sepolia from the injected wallet (switches or adds the chain first).
export async function wallet() {
  const eth = window.ethereum;
  if (!eth) throw new Error("No wallet found. Install MetaMask or another browser wallet, then reload");
  const [account] = await eth.request({ method: "eth_requestAccounts" });
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(sepolia.id) }] });
  } catch (e) {
    if (e?.code !== 4902) throw e;
    await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: toHex(sepolia.id), chainName: "Sepolia", nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"], blockExplorerUrls: ["https://sepolia.etherscan.io"] }] });
  }
  return createWalletClient({ account, chain: sepolia, transport: custom(eth) });
}

// Sends one write from the wallet and waits for a success receipt. Returns the tx hash.
export async function send(w, call) {
  const hash = await w.writeContract(call);
  const r = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error(`the transaction reverted: ${tx(hash)}`);
  return hash;
}
