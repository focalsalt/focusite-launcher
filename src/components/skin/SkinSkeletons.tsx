import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

// Loading placeholders for the skin and cape grids.
export const SkinCardSkeleton: React.FC = () => (
  <div className="flex flex-col justify-between p-3 rounded-xl border border-white/5 bg-white/[0.02] min-h-[120px] space-y-2">
    <div className="flex items-center gap-3">
      <Skeleton className="h-20 w-16 shrink-0 rounded-lg bg-white/5" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-24 rounded bg-white/5" />
        <Skeleton className="h-2.5 w-16 rounded bg-white/5" />
        <Skeleton className="h-2 w-12 rounded bg-white/5" />
      </div>
    </div>
    <div className="pt-2 border-t border-white/5 flex justify-between items-center">
      <Skeleton className="h-3 w-12 rounded bg-white/5" />
    </div>
  </div>
);

export const CapeCardSkeleton: React.FC = () => (
  <div className="flex flex-col justify-between p-3.5 rounded-xl border border-white/5 bg-white/[0.02] min-h-[120px] space-y-2">
    <div className="flex items-center gap-3">
      <Skeleton className="h-20 w-16 shrink-0 rounded-lg bg-white/5" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-28 rounded bg-white/5" />
        <Skeleton className="h-2.5 w-20 rounded bg-white/5" />
      </div>
    </div>
    <div className="pt-2 border-t border-white/5 flex justify-between items-center">
      <Skeleton className="h-3 w-16 rounded bg-white/5" />
    </div>
  </div>
);
