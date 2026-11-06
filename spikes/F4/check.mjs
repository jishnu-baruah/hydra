// Diagnose a status read: record ids and resolve() straight on the resolver, then the Universal Resolver.
import { createPublicClient, http, namehash, toHex, encodeFunctionData, decodeFunctionResult } from "../../apps/api/node_modules/viem/_esm/index.js";
import { sepolia } from "../../apps/api/node_modules/viem/_esm/chains/index.js";
import { packetToBytes } from "../../apps/api/node_modules/viem/_esm/utils/ens/packetToBytes.js";
import { readFileSync } from "node:fs";

const pub = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });
const abi = JSON.parse(readFileSync(new URL("./abi/PermissionedResolver.json", import.meta.url))).abi;
const textAbi = [{ type: "function", name: "text", inputs: [{ type: "bytes32" }, { type: "string" }], outputs: [{ type: "string" }] }];
for (const [file, n] of [["state.json", "hydrastatus.eth"], ["state-demodapp.json", "status.demodapp.eth"], ["state-demodapp.json", "demodapp.eth"]]) {
  const res = JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url))).resolver;
  const id = await pub.readContract({ address: res, abi, functionName: "getRecordId", args: [namehash(n)] }).catch((e) => e.shortMessage);
  const data = encodeFunctionData({ abi: textAbi, functionName: "text", args: [namehash(n), "hydra.status"] });
  const out = await pub.readContract({ address: res, abi, functionName: "resolve", args: [toHex(packetToBytes(n)), data] }).then((r) => decodeFunctionResult({ abi: textAbi, functionName: "text", data: r })).catch((e) => e.shortMessage);
  const viaUr = await pub.getEnsText({ name: n, key: "hydra.status", universalResolverAddress: "0x24e1d8e068620b647ca097f961a61055f4f42d72" }).catch((e) => e.shortMessage);
  console.log(n, { recordId: String(id), direct: out, universal: viaUr });
}
