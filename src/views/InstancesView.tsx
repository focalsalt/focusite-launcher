import React from "react";
import { motion } from "motion/react";
import { Box, Play, Clock, Sparkles, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MinecraftInstance } from "@/types/navigation";

interface InstancesViewProps {
  instances: MinecraftInstance[];
  searchQuery: string;
  onSelectInstance: (instanceId: string) => void;
  onLaunchInstance: (instanceId: string) => void;
}

export const InstancesView: React.FC<InstancesViewProps> = ({
  instances,
  searchQuery,
  onSelectInstance,
  onLaunchInstance,
}) => {
  const filtered = instances.filter(
    (it) =>
      it.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      it.version.includes(searchQuery) ||
      it.loader.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className="space-y-6 max-w-6xl"
    >
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-white/10 rounded-2xl">
          <Box className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-slate-300">未找到符合搜尋條件的實例</p>
          <p className="text-xs text-muted-foreground mt-1">
            嘗試不同的關鍵字，或點擊右上角「建立實例」建立新環境。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((inst) => (
            <Card
              key={inst.id}
              className="group relative overflow-hidden border-white/10 bg-white/5 hover:border-[#52A43A]/40 hover:bg-white/[0.07] transition-all cursor-pointer shadow-sm hover:shadow-lg hover:shadow-[#3C8527]/5"
              onClick={() => onSelectInstance(inst.id)}
            >
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 border border-white/10 text-[#52A43A] group-hover:scale-105 transition-transform shadow-inner">
                      <Box className="h-6 w-6" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold text-slate-100 group-hover:text-[#52A43A] transition-colors">
                        {inst.name}
                      </CardTitle>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          {inst.loader}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                          MC {inst.version}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-2 space-y-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-white/5 pt-3">
                  <div className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-amber-400" />
                    <span>{inst.modCount} 個 Mod (CAS 去重)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{inst.lastPlayed}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onLaunchInstance(inst.id);
                    }}
                    className="flex-1 gap-1.5 bg-[#3C8527] hover:bg-[#469C2D] text-white text-xs font-semibold h-8 rounded-lg shadow-sm shadow-[#3C8527]/25"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>立即啟動</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectInstance(inst.id);
                    }}
                    className="text-xs h-8 rounded-lg border-white/10 hover:bg-white/10"
                  >
                    管理設定
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </motion.div>
  );
};
