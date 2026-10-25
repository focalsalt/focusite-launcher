import React from "react";
import { motion } from "motion/react";
import { ExternalLink, Calendar, Tag, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewsSubNav } from "@/types/navigation";

interface NewsViewProps {
  subNav: NewsSubNav;
}

export const NewsView: React.FC<NewsViewProps> = ({ subNav }) => {
  return (
    <motion.div
      key={subNav}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className="space-y-4 max-w-5xl"
    >
      {subNav === "official" && (
        <div className="space-y-4">
          <Card className="overflow-hidden border-white/10 bg-gradient-to-r from-blue-950/40 via-slate-900/40 to-transparent">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="success">Mojang 官方</Badge>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  2026-10-24
                </span>
              </div>
              <CardTitle className="text-xl">Minecraft 1.21.4 正式版現已發布</CardTitle>
              <CardDescription className="text-sm leading-relaxed text-slate-300">
                包含全新的試煉殿堂挑戰更新、微風怪行為調優，以及更高效能的自訂項目實體渲染支援。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href="https://www.minecraft.net"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <span>閱讀官方完整更新公告</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </CardContent>
          </Card>
        </div>
      )}

      {subNav === "changelog" && (
        <div className="space-y-3">
          <ChangelogEntry
            version="1.21.4"
            date="2026-10-22"
            items={[
              "最佳化了方塊渲染管線，提升了低配顯卡之幀率表現",
              "修正了活塞推動特定方塊時發生的罕見崩潰例外",
              "升級遊戲內建 JRE 執行階段至 Java 21 (LTS)",
            ]}
          />
          <ChangelogEntry
            version="1.21.3"
            date="2026-09-18"
            items={[
              "調整了紅石訊號延遲的判定頻率",
              "修復了伺服器在大量實體同步時的封包溢出問題",
            ]}
          />
        </div>
      )}

      {subNav === "announcements" && (
        <div className="space-y-3">
          <Card className="border-white/10 bg-white/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <CardTitle className="text-base">Focusite Launcher v26.1.0 預覽版上線</CardTitle>
              </div>
              <CardDescription className="text-xs">
                本版本全面接入 Tauri 2.0 原生視窗控制，並啟用 CAS 內容尋址去重與離線日誌 AST 診斷。
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      )}
    </motion.div>
  );
};

function ChangelogEntry({
  version,
  date,
  items,
}: {
  version: string;
  date: string;
  items: string[];
}) {
  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-blue-400" />
            <CardTitle className="text-base">Minecraft Java {version}</CardTitle>
          </div>
          <span className="text-xs text-muted-foreground">{date}</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <ul className="list-disc list-inside space-y-1 text-xs text-slate-300">
          {items.map((it, idx) => (
            <li key={idx}>{it}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
