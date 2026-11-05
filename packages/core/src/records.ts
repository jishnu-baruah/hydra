// Shared record contract for Arkiv. See docs/ARCHITECTURE.md before changing.
// Arkiv rejects uppercase attribute names, so every name here is lowercase.

export const PROJECT = "hydra" as const;

export type RecordType = "app" | "release" | "file" | "observation";

export type ObservationStatus = "match" | "mismatch" | "unknown";

export interface AppAttributes {
  project: typeof PROJECT;
  type: "app";
  app: string;
  domain: string;
  publisher: string;
  created_at: bigint; // u64 ms
}

export interface ReleaseAttributes {
  project: typeof PROJECT;
  type: "release";
  app: string;
  version: string;
  commit: string;
  swarm_ref: string;
  file_count: bigint;
  published_at: bigint; // u64 ms
  source: "ci";
}

export interface FileAttributes {
  project: typeof PROJECT;
  type: "file";
  app: string;
  sha256: string;
  path: string;
  release: string; // release entity key
}

export interface ObservationAttributes {
  project: typeof PROJECT;
  type: "observation";
  domain: string;
  app?: string;
  status: ObservationStatus;
  observed_at: bigint; // u64 ms
  scripts_hash: string;
}

export interface Manifest {
  app: string;
  version: string;
  commit: string;
  domains: string[];
  files: Record<string, string>; // path -> "sha256-<hex>"
  scripts: Record<string, string>; // external script URL -> "sha256-<hex>"
}
