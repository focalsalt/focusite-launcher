# Focusite Launcher 工程與設計規範 (Project Invariants & Design Standards)

定義 Focusite Launcher 工作區專案之核心架構、UI/UX 規範、物理動態與工程底線。

---

## 1. 桌面排版與捲動規範 (Desktop Architecture & ScrollArea Invariant)
1. **零排版抖動捲動 (Zero Layout Shift)**：
   - 全專案嚴禁使用原生 CSS `overflow-y: auto` / `overflow-y: overlay` 搭配 Webkit 偽類。
   - 所有可捲動區域必須強制採用封裝之 `@/components/ui/scroll-area` 元件。
   - 核心 Viewport 強制注入 `scrollbar-width: none; -ms-overflow-style: none; ::-webkit-scrollbar: none;`，以恆定 100% 容器寬度確保 0px 排版位移。
   - 捲動條必須以絕對定位之自訂懸浮滑塊 (Overlay Thumb) 渲染，脫離排版流，支援自動懸停/捲動淡入與 900ms 平滑淡出。

2. **主視圖一體化畫布 (Unified Page Canvas)**：
   - 頂部操作列、標題列 (Titlebar) 與主要內容必須作為單一視圖實體封裝於 `<AnimatePresence>` 畫布中。
   - 嚴禁將 Titlebar 獨立懸浮於 `<main>` 之外，確保各視圖（包含頂部全寬貼合之 Hero Banner）切換時整體畫布同步過渡。

---

## 2. 空間動效與物理方向慣性 (Spatial Motion & Directional Physics)
1. **雙向物理方向過渡 (Bidirectional Directional Physics)**：
   - 嚴禁使用固定單向的位移參數。所有轉場必須根據人機互動空間軸線計算動態向量。
   - **垂直軸線 (Sidebar -> Main Views)**：
     - 依據 `VIEW_INDEX` 映射 (`news: 0, home: 1, instances: 2, instance-detail: 3, settings: 4`) 計算向量 `direction = targetIndex > currentIndex ? 1 : -1`。
     - 向下導覽時新頁面由下方推入 (`y: 24 -> 0`)，舊頁面向上移出 (`y: -24`)。
     - 向上導覽時新頁面由上方推入 (`y: -24 -> 0`)，舊頁面向下移出 (`y: 24`)。
   - **水平軸線 (Sub-Tabs / Carousels)**：
     - 依據水平分頁索引 `SUB_TAB_ORDER` 計算向量。
     - 向右切換新內容由右側推入 (`x: 32 -> 0`)，向左切換新內容由左側推入 (`x: -32 -> 0`)。
   - **物理阻尼曲線**：
     - 統一採用輕量彈簧設定：`transition: { type: "spring" as const, stiffness: 450, damping: 35, mass: 0.8 }`。

2. **Motion layoutId 作用域隔離 (LayoutId Scope Isolation)**：
   - `layoutId` 必須依功能範疇具名加綴（例如 `news-subnav-indicator`、`home-subnav-indicator`、`instance-detail-tab-pill`）。
   - 嚴禁在跨獨立業務頁面或無連貫空間關係之組件間共用全域單一識別鍵，杜絕非預期的跨頁面水平飛躍。

---

## 3. 側邊欄指示器架構 (Sidebar Capsule Invariant)
1. **全局無裁切渲染**：
   - 活躍膠囊指示器必須置於 `<aside>` 根層級單一浮動渲染，座標定位於 `left-0`，杜絕跨容器平移時因內部 `ScrollArea` 的 `overflow-y` 邊界產生裁切閃逝。
2. **捲動零延遲動態分離 (Zero Scroll Lag)**：
   - 點擊導覽切換時啟用 Spring 物理彈簧平移動態 (`stiffness: 500, damping: 38`)。
   - 列表捲動時監聽 `onScroll`，將 Motion 動態參數切換為 `duration: 0`，使膠囊在捲動幀中以 144Hz 原生無延遲精準鎖定選取項目。

---

## 4. 設計系統與品牌合約 (Design System & Brand Contract)
1. **全量 Shadcn UI 與 Motion 原語約束**：
   - 嚴禁使用未封裝之原生 HTML 控制項（如原生 range input、text input、未定義無障礙之 dialog）。
   - 全面強制採用 Shadcn UI 強型別元件（`Slider`、`Switch`、`Input`、`Dialog`、`Button`、`ScrollArea`、`Badge`、`Card`）。
   - 互動按鈕與卡片一律配置 Motion 觸覺反饋：`whileHover: { scale: 1.02 }, whileTap: { scale: 0.98 }`。

2. **Focusite 品牌色調與版本號合約**：
   - **品牌色調**：
     - 核心主色：`#3C8527` (Core Focusite Green)
     - 高亮與發光：`#52A43A` (Highlight Green / Glow)
     - 深色背景/漸層：`#2E6B1D` (Dark Green / Shadow)
     - 嚴禁無授權採用通用藍色或未定義之雜色。
   - **版本號合約**：
     - 啟動器當前版本固定為 `26.1.0`。
     - Rust Cargo Workspace、`tauri.conf.json`、`package.json` 以及 UI 標題列標籤一律嚴格對齊一致。
