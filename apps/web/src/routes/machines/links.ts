/** One repository linked from one of the user's machines (GET /agents/repo-links). */
export interface MachineRepoLink {
  link: {
    id: string;
    projectId: string;
    machineId: string;
    displayPath: string;
    defaultBranch: string | null;
    permissionMode: "MANUAL" | "ASSISTED" | "AUTO_RUN";
    status: "ACTIVE" | "REVOKED";
  };
  project: { id: string; key: string; name: string };
  auto_approve: boolean;
  /** Project admins in a browser session may switch auto-approve. */
  can_change_mode: boolean;
}

/** Links grouped under the machine they belong to, in the API's order. */
export function linksByMachine(links: MachineRepoLink[]): Map<string, MachineRepoLink[]> {
  const out = new Map<string, MachineRepoLink[]>();
  for (const row of links) {
    const list = out.get(row.link.machineId) ?? [];
    list.push(row);
    out.set(row.link.machineId, list);
  }
  return out;
}
