import { invoke } from "@tauri-apps/api/core";
import { join, tempDir } from "@tauri-apps/api/path";
import { p2pService } from "@/services/p2pService";
import { partyService, type ShareInfo, type ShareMod, type ShareSpec } from "@/services/partyService";
import { workshopService, type InstallPlanItem } from "@/services/workshopService";

/** What joining a shared world will do on this computer. */
export interface JoinPlan {
  /** A local instance that already fits; null means a new one is built. */
  instanceId: string | null;
  /** Mods Modrinth knows, downloaded automatically. */
  install: ShareMod[];
  /** Mods Modrinth does not know: the guest has to get these from the sharer. */
  manual: ShareMod[];
}

export type JoinStep = "linking" | "jar" | "creating" | "provisioning" | "mods";

export const planJoin = async (spec: ShareSpec): Promise<JoinPlan> => {
  const found = await invoke<{ instanceId: string | null; missing: ShareMod[] }>("instance_find_match", { spec });
  const known = (m: ShareMod) => !!(m.downloadUrl && m.projectId && m.versionId);
  return { instanceId: found.instanceId, install: found.missing.filter(known), manual: found.missing.filter((m) => !known(m)) };
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Resolves once the tunnel to `sharer` is set up; rejects when it fails or takes too long. */
const waitLinked = (sharer: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => done(new Error("The tunnel did not come up")), 45_000);
    const check = () => {
      const w = partyService.getSnapshot().world;
      if (w.state === "linked" && w.with === sharer) done();
      else if (w.state === "idle") done(new Error("The shared world could not be reached"));
    };
    const done = (err?: Error) => {
      window.clearTimeout(timer);
      unsubscribe();
      if (err) reject(err);
      else resolve();
    };
    const unsubscribe = partyService.subscribe(check);
    check();
  });

/** The data channel may still be opening when the answer has just been sent, so fetching retries for a while. */
const fetchJar = async (session: string, jar: NonNullable<ShareSpec["customJar"]>): Promise<string> => {
  if (!/^[0-9a-f]{40}$/.test(jar.sha1)) throw new Error("The shared custom jar has an invalid hash");
  const dest = await join(await tempDir(), `focusite-${jar.sha1}.jar`);
  let last: unknown;
  for (let i = 0; i < 15; i++) {
    // Stop once the tunnel is gone (the sharer left or we left): nothing can arrive any more.
    if (partyService.joinedSession() !== session) throw last ?? new Error("The tunnel was closed");
    try {
      await p2pService.fetchFile(session, jar.sha1, jar.size, dest);
      return dest;
    } catch (e) {
      last = e;
      await sleep(2000);
    }
  }
  throw last;
};

const toPlanItem = (m: ShareMod): InstallPlanItem => ({
  project_id: m.projectId!,
  version_id: m.versionId!,
  name: m.filename,
  filename: m.filename,
  download_url: m.downloadUrl!,
  sha1: m.sha1,
  size: m.size,
  is_primary: true,
  is_required_dep: false,
  is_optional_dep: false,
  already_installed: false,
});

/**
 * Joins a shared world: opens the tunnel, then builds (or tops up) the instance that fits it. Returns the instance id.
 * The tunnel comes first because a custom loader jar can only come through it. A failure closes the tunnel again.
 */
export const joinSharedWorld = async (share: ShareInfo, plan: JoinPlan, onStep: (step: JoinStep) => void): Promise<string> => {
  try {
    onStep("linking");
    partyService.requestJoin(share.by);
    await waitLinked(share.by);

    let instanceId = plan.instanceId;
    if (!instanceId) {
      let jarPath: string | null = null;
      if (share.spec.customJar) {
        onStep("jar");
        const session = partyService.joinedSession();
        if (!session) throw new Error("The tunnel was closed");
        jarPath = await fetchJar(session, share.spec.customJar);
      }
      onStep("creating");
      instanceId = (await invoke<{ id: string }>("instance_create_from_share", { spec: share.spec, jarPath })).id;
      onStep("provisioning");
      await invoke("instance_provision", { instanceId });
    }
    if (plan.install.length > 0) {
      onStep("mods");
      await workshopService.executeInstallPlan(instanceId, "mod", plan.install.map(toPlanItem));
    }
    return instanceId;
  } catch (e) {
    partyService.leaveWorld();
    throw e;
  }
};
