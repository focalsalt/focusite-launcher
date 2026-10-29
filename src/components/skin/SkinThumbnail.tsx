import React, { useState, useEffect } from "react";
import { ImageOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { skinThumbnailService, ThumbnailOptions } from "@/services/skinThumbnailService";

export interface SkinThumbnailProps extends ThumbnailOptions {
  className?: string;
  alt?: string;
}

export const SkinThumbnail: React.FC<SkinThumbnailProps> = ({
  skinUrl,
  capeUrl,
  model = "auto-detect",
  backEquipment = "cape",
  rotationY = 0,
  className = "",
  alt = "Minecraft Skin Preview",
}) => {
  const opts: ThumbnailOptions = {
    skinUrl,
    capeUrl,
    model,
    backEquipment,
    rotationY,
  };

  const cached = skinThumbnailService.getCached(opts);
  const [dataUrl, setDataUrl] = useState<string | null>(cached || null);
  const [loading, setLoading] = useState<boolean>(!cached);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const currentCached = skinThumbnailService.getCached(opts);
    if (currentCached) {
      setDataUrl(currentCached);
      setLoading(false);
      setHasError(!currentCached);
      return;
    }

    setLoading(true);
    setHasError(false);
    skinThumbnailService
      .getThumbnail(opts)
      .then((url) => {
        if (isMounted) {
          setDataUrl(url);
          setLoading(false);
          setHasError(!url);
        }
      })
      .catch(() => {
        if (isMounted) {
          setDataUrl(null);
          setLoading(false);
          setHasError(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [skinUrl, capeUrl, model, backEquipment, rotationY]);

  if (loading) {
    return <Skeleton className={`w-full h-full rounded-lg ${className}`} />;
  }

  if (hasError || !dataUrl) {
    return (
      <div
        className={`flex flex-col items-center justify-center w-full h-full rounded-lg bg-black/60 text-slate-500 border border-white/5 p-1 ${className}`}
        title="貼圖載入失敗"
      >
        <ImageOff className="h-4 w-4 text-slate-600 mb-0.5" />
        <span className="text-[8px] text-slate-600 font-mono">NO TEXTURE</span>
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={alt}
      className={`w-full h-full object-contain pointer-events-none select-none ${className}`}
      loading="lazy"
    />
  );
};
