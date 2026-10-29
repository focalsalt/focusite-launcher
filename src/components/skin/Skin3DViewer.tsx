import React, { useEffect, useRef, useState } from "react";
import * as skinview3d from "skinview3d";

export interface Skin3DViewerProps {
  skinUrl?: string;
  capeUrl?: string;
  modelVariant?: "default" | "slim" | "auto-detect";
  backEquipment?: "cape" | "elytra";
  animation?: "idle" | "walk" | "run";
  autoRotate?: boolean;
  width?: number;
  height?: number;
  className?: string;
  initialRotationY?: number;
  enableControls?: boolean;
  renderPaused?: boolean;
  responsive?: boolean;
}

export const Skin3DViewer: React.FC<Skin3DViewerProps> = ({
  skinUrl,
  capeUrl,
  modelVariant = "auto-detect",
  backEquipment = "cape",
  animation = "idle",
  autoRotate = false,
  width = 280,
  height = 360,
  className = "",
  initialRotationY = 0,
  enableControls = true,
  renderPaused = false,
  responsive = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<skinview3d.SkinViewer | null>(null);
  const [contextEpoch, setContextEpoch] = useState<number>(0);

  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width,
    height,
  });

  // 支援自適應動態尺寸監聽 (ResizeObserver)
  useEffect(() => {
    if (!responsive || !containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          setDimensions({
            width: Math.floor(w),
            height: Math.floor(h),
          });
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [responsive]);

  const activeWidth = responsive ? dimensions.width : width;
  const activeHeight = responsive ? dimensions.height : height;

  // 監聽 WebGL Context 失去與復原事件，防止 Chromium / WebView2 逐出後永久黑屏
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn("Skin3DViewer: WebGL context lost event intercepted.");
    };

    const handleContextRestored = () => {
      console.info("Skin3DViewer: WebGL context restored. Rebuilding scene...");
      setContextEpoch((prev) => prev + 1);
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    };
  }, []);

  // 初始化 SkinViewer (抽離尺寸與旋轉更新，避免重建 WebGL Context)
  useEffect(() => {
    if (!canvasRef.current) return;

    const initialModel =
      modelVariant === "slim"
        ? "slim"
        : modelVariant === "default"
        ? "default"
        : "auto-detect";

    const viewer = new skinview3d.SkinViewer({
      canvas: canvasRef.current,
      width: activeWidth,
      height: activeHeight,
      model: initialModel,
      enableControls,
      renderPaused,
    });

    viewer.fov = 65;
    viewer.zoom = 0.85;
    viewer.playerObject.rotation.y = initialRotationY;

    if (viewer.controls) {
      viewer.controls.enabled = enableControls;
    }

    viewerRef.current = viewer;

    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [enableControls, renderPaused, contextEpoch]);

  // 動態平滑調整渲染視窗尺寸，不銷毀 WebGL Context
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (activeWidth > 0 && activeHeight > 0) {
      viewer.setSize(activeWidth, activeHeight);
      if (renderPaused) {
        viewer.render();
      }
    }
  }, [activeWidth, activeHeight, renderPaused]);

  // 旋轉角度更新
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.playerObject.rotation.y = initialRotationY;
    if (renderPaused) {
      viewer.render();
    }
  }, [initialRotationY, renderPaused]);

  // 獨立自動旋轉幀循環 (與肢體動作疊加共存)
  useEffect(() => {
    if (!autoRotate) return;
    let reqId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      if (viewerRef.current) {
        viewerRef.current.playerObject.rotation.y += delta * 0.75;
        if (renderPaused) {
          viewerRef.current.render();
        }
      }
      reqId = requestAnimationFrame(loop);
    };

    reqId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(reqId);
    };
  }, [autoRotate, renderPaused]);

  // 更新皮膚
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (skinUrl) {
      viewer
        .loadSkin(skinUrl, {
          model: modelVariant ?? "auto-detect",
        })
        .then(() => {
          if (renderPaused) {
            viewer.playerObject.rotation.y = initialRotationY;
            viewer.render();
          }
        })
        .catch((err) => {
          console.warn("Failed to load skin in 3D viewer:", err);
        });
    } else {
      viewer.resetSkin();
      if (renderPaused) {
        viewer.render();
      }
    }
  }, [skinUrl, modelVariant, renderPaused, initialRotationY, contextEpoch]);

  // 更新披風與鞘翅
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (capeUrl) {
      viewer
        .loadCape(capeUrl, { backEquipment })
        .then(() => {
          if (renderPaused) {
            viewer.playerObject.rotation.y = initialRotationY;
            viewer.render();
          }
        })
        .catch((err) => {
          console.warn("Failed to load cape in 3D viewer:", err);
        });
    } else {
      viewer.resetCape();
      if (renderPaused) {
        viewer.render();
      }
    }
  }, [capeUrl, backEquipment, renderPaused, initialRotationY, contextEpoch]);

  // 更新肢體動作模式
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || renderPaused) return;

    if (animation === "walk") {
      const anim = new skinview3d.WalkingAnimation();
      anim.speed = 0.55;
      viewer.animation = anim;
    } else if (animation === "run") {
      const anim = new skinview3d.RunningAnimation();
      anim.speed = 0.65;
      viewer.animation = anim;
    } else {
      viewer.animation = null;
    }
  }, [animation, renderPaused, contextEpoch]);

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center overflow-hidden rounded-2xl select-none ${className}`}
      style={
        responsive
          ? { width: "100%", height: "100%" }
          : { width: activeWidth, height: activeHeight }
      }
    >
      <canvas
        ref={canvasRef}
        className={enableControls ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}
      />
    </div>
  );
};
