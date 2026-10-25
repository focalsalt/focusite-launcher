import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  viewportClassName?: string;
  viewportRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      children,
      className,
      viewportClassName,
      viewportRef: externalViewportRef,
      onScroll,
      ...props
    },
    ref
  ) => {
    const internalViewportRef = useRef<HTMLDivElement>(null);
    const viewportRef = externalViewportRef || internalViewportRef;

    const [thumbHeight, setThumbHeight] = useState<number>(0);
    const [thumbTop, setThumbTop] = useState<number>(0);
    const [isScrollable, setIsScrollable] = useState<boolean>(false);
    const [isScrolling, setIsScrolling] = useState<boolean>(false);
    const [isHovered, setIsHovered] = useState<boolean>(false);
    const [isDragging, setIsDragging] = useState<boolean>(false);

    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dragStartYRef = useRef<number>(0);
    const dragStartScrollTopRef = useRef<number>(0);

    // 重新計算滾動條 Thumb 高度與位置
    const updateThumb = useCallback(() => {
      const el = viewportRef.current;
      if (!el) return;

      const { clientHeight, scrollHeight, scrollTop } = el;
      const canScroll = scrollHeight > clientHeight + 2;
      setIsScrollable(canScroll);

      if (!canScroll) {
        setThumbHeight(0);
        setThumbTop(0);
        return;
      }

      // 最小 Thumb 高度 24px，避免極長內容時 Thumb 過小無法點擊
      const calculatedHeight = Math.max(
        24,
        (clientHeight / scrollHeight) * clientHeight
      );
      setThumbHeight(calculatedHeight);

      const maxScrollTop = scrollHeight - clientHeight;
      const maxThumbTop = clientHeight - calculatedHeight;
      const calculatedTop =
        maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;
      setThumbTop(calculatedTop);
    }, [viewportRef]);

    // 監聽 Viewport 與內容尺寸變化 (零佈局抖動)
    useEffect(() => {
      const el = viewportRef.current;
      if (!el) return;

      updateThumb();

      const observer = new ResizeObserver(() => {
        updateThumb();
      });

      observer.observe(el);
      if (el.firstElementChild) {
        observer.observe(el.firstElementChild);
      }

      return () => {
        observer.disconnect();
      };
    }, [updateThumb, viewportRef]);

    // 滾動事件處理
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      updateThumb();
      setIsScrolling(true);

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 900);

      if (onScroll) {
        onScroll(e);
      }
    };

    // 拖曳 Thumb
    const handleThumbMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const el = viewportRef.current;
      if (!el) return;

      setIsDragging(true);
      dragStartYRef.current = e.clientY;
      dragStartScrollTopRef.current = el.scrollTop;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaY = moveEvent.clientY - dragStartYRef.current;
        const { clientHeight, scrollHeight } = el;
        const maxScrollTop = scrollHeight - clientHeight;
        const maxThumbTop = clientHeight - thumbHeight;

        if (maxThumbTop > 0) {
          const scrollDelta = (deltaY / maxThumbTop) * maxScrollTop;
          el.scrollTop = dragStartScrollTopRef.current + scrollDelta;
        }
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    };

    // 點擊軌道跳轉
    const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const el = viewportRef.current;
      if (!el) return;

      const trackRect = e.currentTarget.getBoundingClientRect();
      const clickY = e.clientY - trackRect.top;
      const { clientHeight, scrollHeight } = el;
      const targetScrollTop =
        (clickY / clientHeight) * (scrollHeight - clientHeight);

      el.scrollTo({
        top: targetScrollTop,
        behavior: "smooth",
      });
    };

    // 顯示 Thumb 的時機：正在拖曳、正在滾動、或滑鼠懸停於 ScrollArea 上
    const showThumb =
      isScrollable && (isDragging || isScrolling || isHovered);

    return (
      <div
        ref={ref}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={cn("relative overflow-hidden", className)}
        {...props}
      >
        {/* 核心滾動視口 (強制隱藏原生捲動條，恆定寬度，達成 0px 排版位移) */}
        <div
          ref={viewportRef}
          onScroll={handleScroll}
          className={cn(
            "h-full w-full overflow-y-auto overflow-x-hidden scrollbar-none",
            viewportClassName
          )}
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
          }}
        >
          {children}
        </div>

        {/* 自訂浮層捲動條軌道與滑塊 (完全脫離文檔排版流，保證零位移) */}
        {isScrollable && (
          <div
            onClick={handleTrackClick}
            className="pointer-events-auto absolute top-0 right-0 bottom-0 w-2.5 z-30 transition-opacity duration-200"
          >
            <div
              onMouseDown={handleThumbMouseDown}
              style={{
                height: `${thumbHeight}px`,
                transform: `translateY(${thumbTop}px)`,
              }}
              className={cn(
                "absolute right-1 w-1 rounded-full cursor-pointer transition-colors duration-150",
                showThumb ? "opacity-100" : "opacity-0",
                isDragging
                  ? "bg-[#52A43A] shadow-[0_0_8px_rgba(82,164,58,0.8)]"
                  : isHovered
                  ? "bg-white/30 hover:bg-[#52A43A]/80"
                  : "bg-white/15"
              )}
            />
          </div>
        )}
      </div>
    );
  }
);

ScrollArea.displayName = "ScrollArea";
