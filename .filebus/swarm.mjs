// swarm.mjs — launch N workers in parallel, wait for them to drain the board, then print the board.
//   node swarm.mjs [n]      (default 3)   |   DRY=1 node swarm.mjs   to run with no API keys
import { spawn } from "node:child_process";
const n = Number(process.argv[2]) || 3;
const procs = Array.from({ length: n }, (_, i) =>
  new Promise((res) => {
    const p = spawn(process.execPath, ["worker.mjs"], {
      stdio: "inherit", env: { ...process.env, WORKER_ID: `w${i + 1}` },
    });
    p.on("exit", res);
  }));
console.log(`swarm: ${n} workers`);
await Promise.all(procs);
spawn(process.execPath, ["scripts/board.mjs", "summary"], { stdio: "inherit" });
