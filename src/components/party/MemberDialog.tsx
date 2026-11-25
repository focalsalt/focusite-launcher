import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { toUserMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { partyService, type ShareInfo, useParty } from "@/services/partyService";
import { type JoinPlan, type JoinStep, joinSharedWorld, planJoin } from "@/services/worldJoin";

/** Instance name, version, loader and mod count of a shared world. */
export const ShareInfoLines: React.FC<{ share: ShareInfo }> = ({ share }) => {
  const { t } = useI18n();
  const { spec } = share;
  const unknown = spec.mods.filter((m) => m.side === "unknown").length;
  return (
    <div className="space-y-0.5 text-xs">
      <p className="font-semibold text-slate-100">{spec.instanceName}</p>
      <p className="text-slate-400">
        {spec.mcVersion} · {spec.loader}
      </p>
      <p className="text-slate-400">{t.party.modCount(spec.mods.length, unknown)}</p>
    </div>
  );
};

interface MemberDialogProps {
  memberId: string | null;
  onClose: () => void;
}

/** What a click on a member offers: joining their shared world, and the host's member controls. */
export const MemberDialog: React.FC<MemberDialogProps> = ({ memberId, onClose }) => {
  const { t } = useI18n();
  const party = useParty();
  const member = party.members.find((m) => m.id === memberId);
  const share = party.shares.find((s) => s.by === memberId);
  const isHost = party.self !== null && party.self === party.host;
  const other = memberId !== party.self;
  const canJoin = !!share && other;
  const canManage = isHost && other;
  const linked = party.world.with === memberId && party.world.state === "linked";
  const open = !!member && (canJoin || canManage);

  const [plan, setPlan] = useState<JoinPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [step, setStep] = useState<JoinStep | null>(null);

  // What joining would do is worked out when the dialog opens (and again if the shared world changes).
  const spec = share?.spec;
  useEffect(() => {
    setPlan(null);
    setPlanError(null);
    if (!open || !canJoin || !spec || linked) return;
    let stale = false;
    planJoin(spec)
      .then((p) => !stale && setPlan(p))
      .catch((e) => !stale && setPlanError(toUserMessage(e)));
    return () => {
      stale = true;
    };
  }, [open, canJoin, spec, linked]);

  const running = step !== null;
  const stepText: Record<JoinStep, string> = {
    linking: t.party.stepLinking,
    jar: t.party.stepJar,
    creating: t.party.stepCreating,
    provisioning: t.party.stepProvisioning,
    mods: t.party.stepMods,
  };

  const join = async () => {
    if (!share || !plan) return;
    try {
      await joinSharedWorld(share, plan, setStep);
      toast(t.party.joinedDone(share.spec.instanceName), "success");
      onClose();
    } catch (e) {
      toast(t.party.joinFailed(toUserMessage(e)), "error");
    } finally {
      setStep(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="max-w-sm border-white/10 bg-slate-900/98 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">{canJoin ? t.party.joinWorldTitle : member?.name}</DialogTitle>
          {canJoin && <DialogDescription className="text-xs text-slate-400">{t.party.joinWorldDesc(member?.name ?? "")}</DialogDescription>}
        </DialogHeader>
        {share && canJoin && (
          <div className="space-y-2">
            <ShareInfoLines share={share} />
            {plan && !linked && (
              <div className="space-y-1 rounded-lg bg-white/5 p-2 text-xs text-slate-300">
                <p>{plan.instanceId ? t.party.useExisting : t.party.willCreate(share.spec.instanceName)}</p>
                {plan.install.length > 0 && <p>{t.party.willDownload(plan.install.length)}</p>}
                {plan.manual.length > 0 && (
                  <p className="text-amber-300">{t.party.manualMods(member?.name ?? "", plan.manual.map((m) => m.filename).join(", "))}</p>
                )}
              </div>
            )}
            {planError && <p className="text-xs text-rose-300">{t.party.planFailed(planError)}</p>}
            {running && <p className="text-xs text-emerald-300">{stepText[step]}</p>}
          </div>
        )}
        <DialogFooter className="gap-2">
          {canManage && !running && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 bg-white/5 text-xs"
                onClick={() => {
                  partyService.transfer(memberId!);
                  onClose();
                }}
              >
                {t.party.transferHost}
              </Button>
              <Button
                size="sm"
                className="bg-rose-600 text-xs text-white hover:bg-rose-500"
                onClick={() => {
                  partyService.kick(memberId!);
                  onClose();
                }}
              >
                {t.party.kickMember}
              </Button>
            </>
          )}
          {canJoin &&
            (linked ? (
              <Button
                size="sm"
                variant="secondary"
                className="text-xs"
                onClick={() => {
                  partyService.leaveWorld();
                  onClose();
                }}
              >
                {t.party.leaveWorld}
              </Button>
            ) : (
              <Button size="sm" className="text-xs" disabled={!plan || running || party.world.state !== "idle"} onClick={() => void join()}>
                {t.party.joinWorld}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
