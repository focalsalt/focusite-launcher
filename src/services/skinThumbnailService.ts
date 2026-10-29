import * as skinview3d from "skinview3d";

export interface ThumbnailOptions {
  skinUrl?: string;
  capeUrl?: string;
  model?: "default" | "slim" | "auto-detect";
  backEquipment?: "cape" | "elytra";
  rotationY?: number;
}

class SkinThumbnailService {
  private cache = new Map<string, string>();
  private canvas: HTMLCanvasElement | null = null;
  private viewer: skinview3d.SkinViewer | null = null;
  private queue: Promise<void> = Promise.resolve();

  private getCacheKey(opts: ThumbnailOptions): string {
    return [
      opts.skinUrl || "",
      opts.capeUrl || "",
      opts.model || "auto-detect",
      opts.backEquipment || "cape",
      (opts.rotationY ?? 0).toFixed(3),
    ].join("|");
  }

  public getCached(opts: ThumbnailOptions): string | undefined {
    return this.cache.get(this.getCacheKey(opts));
  }

  private initViewer(): skinview3d.SkinViewer | null {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return null;
    }
    if (!this.viewer) {
      try {
        this.canvas = document.createElement("canvas");
        this.canvas.width = 120;
        this.canvas.height = 152;
        this.viewer = new skinview3d.SkinViewer({
          canvas: this.canvas,
          width: 120,
          height: 152,
          enableControls: false,
          renderPaused: true,
        });
        this.viewer.fov = 65;
        this.viewer.zoom = 0.85;
      } catch (err) {
        console.warn("Failed to initialize offscreen SkinViewer for thumbnails:", err);
        this.viewer = null;
      }
    }
    return this.viewer;
  }

  public getThumbnail(opts: ThumbnailOptions): Promise<string> {
    const key = this.getCacheKey(opts);
    const cached = this.cache.get(key);
    if (cached) {
      return Promise.resolve(cached);
    }

    return new Promise<string>((resolve) => {
      this.queue = this.queue.then(async () => {
        // Double check cache in case a previous task in the queue resolved it
        const alreadyDone = this.cache.get(key);
        if (alreadyDone) {
          resolve(alreadyDone);
          return;
        }

        const viewer = this.initViewer();
        if (!viewer || !this.canvas) {
          resolve("");
          return;
        }

        try {
          // 載入皮膚或重設
          if (opts.skinUrl) {
            await viewer.loadSkin(opts.skinUrl, {
              model: opts.model ?? "auto-detect",
            });
          } else {
            viewer.resetSkin();
          }

          // 載入披風或重設
          if (opts.capeUrl) {
            await viewer.loadCape(opts.capeUrl, {
              backEquipment: opts.backEquipment ?? "cape",
            });
          } else {
            viewer.resetCape();
          }

          viewer.playerObject.rotation.y = opts.rotationY ?? 0;
          viewer.render();

          const dataUrl = this.canvas.toDataURL("image/png");
          this.cache.set(key, dataUrl);
          resolve(dataUrl);
        } catch (err) {
          console.warn("Failed to render thumbnail for key", key, err);
          resolve("");
        }
      });
    });
  }
}

export const skinThumbnailService = new SkinThumbnailService();
