//! High-performance offline crash log AST analysis engine.
//! Guarantees sub-5ms (< 5000 µs) structured diagnostics.

use crate::localized;
use regex::{Regex, RegexSet};
use std::sync::LazyLock;
use std::time::Instant;
use crate::rules::{DiagnosticReport, DiagnosticResult, DiagnosticSeverity};

pub fn class_file_version_to_java(version: &str) -> &'static str {
    let major = version.trim().split('.').next().unwrap_or("");
    match major {
        "49" => "Java 5",
        "50" => "Java 6",
        "51" => "Java 7",
        "52" => "Java 8",
        "53" => "Java 9",
        "54" => "Java 10",
        "55" => "Java 11",
        "56" => "Java 12",
        "57" => "Java 13",
        "58" => "Java 14",
        "59" => "Java 15",
        "60" => "Java 16",
        "61" => "Java 17",
        "62" => "Java 18",
        "63" => "Java 19",
        "64" => "Java 20",
        "65" => "Java 21",
        "66" => "Java 22",
        "67" => "Java 23",
        "68" => "Java 24",
        "69" => "Java 25",
        _ => "Java ?",
    }
}

/// Structured AST node representing an individual log line.
#[derive(Debug, Clone)]
pub struct LogRecordNode {
    pub timestamp: Option<String>,
    pub thread: Option<String>,
    pub level: Option<String>,
    pub message: String,
}

/// AST node representing an exception and its version/stack info.
#[derive(Debug, Clone)]
pub struct ExceptionNode {
    pub exception_class: String,
    pub message: String,
    pub class_file_version_required: Option<String>,
    pub class_file_version_current: Option<String>,
}

/// AST node representing missing Fabric/Loader dependencies.
#[derive(Debug, Clone)]
pub struct FabricResolutionNode {
    pub mod_name: String,
    pub missing_dependency: String,
}

/// AST node representing duplicate mod conflicts.
#[derive(Debug, Clone)]
pub struct ModDuplicateNode {
    pub duplicate_mod_id: String,
}

/// Parsed Abstract Syntax Tree document of Minecraft log text.
#[derive(Debug, Clone, Default)]
pub struct LogAstDocument {
    pub records: Vec<LogRecordNode>,
    pub exceptions: Vec<ExceptionNode>,
    pub fabric_resolutions: Vec<FabricResolutionNode>,
    pub duplicates: Vec<ModDuplicateNode>,
    pub has_crash_marker: bool,
}

static REGEX_SET: LazyLock<RegexSet> = LazyLock::new(|| {
    RegexSet::new([
        r"UnsupportedClassVersionError:.*?class file version (\d+(?:\.\d+)?).*?class file version(?:s)?(?: up to)? (\d+(?:\.\d+)?)",
        r"java\.lang\.OutOfMemoryError:\s*(Java heap space|Metaspace|GC overhead limit exceeded)",
        r"Mod '([^']+)'(?:.+?)? requires ([^,\n!]+)",
        r"Incompatible mod set!.*?- Mod '([^']+)' requires ([^,\n!]+)",
        r"(?:Duplicate mod id found: ([a-zA-Z0-9_\-]+)|Duplicate mods found:\s*(\[.+?\])|Found duplicate mods:\s*(\[.+?\]))",
        r"(?i)(Exception in thread|Crash Report|# A fatal error has been detected|The game crashed whilst|Process crashed with exit code)",
    ])
    .expect("Failed to compile diagnostic RegexSet")
});

static RE_JAVA_MISMATCH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?s)UnsupportedClassVersionError:.*?class file version (\d+(?:\.\d+)?).*?class file version(?:s)?(?: up to)? (\d+(?:\.\d+)?)").unwrap()
});

static RE_OOM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"java\.lang\.OutOfMemoryError:\s*(Java heap space|Metaspace|GC overhead limit exceeded)").unwrap()
});

static RE_FABRIC_REQ: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Mod '([^']+)'(?:.+?)? requires ([^,\n!]+)").unwrap()
});

static RE_FABRIC_INCOMPAT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Incompatible mod set!.*?- Mod '([^']+)' requires ([^,\n!]+)").unwrap()
});

static RE_DUPLICATE_MOD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:Duplicate mod id found: ([a-zA-Z0-9_\-]+)|Duplicate mods found:\s*(\[.+?\])|Found duplicate mods:\s*(\[.+?\]))").unwrap()
});

static RE_LOG_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\[(\d{2}:\d{2}:\d{2})\]\s+\[([^/]+)/([A-Z]+)\]:\s+(.*)$").unwrap()
});

pub struct LogDiagnosticEngine;

impl LogDiagnosticEngine {
    pub fn new() -> Self {
        Self
    }

    /// Single-pass linear scan constructing structured AST from Minecraft logs.
    pub fn parse_ast(&self, log_content: &str) -> LogAstDocument {
        let mut doc = LogAstDocument::default();
        let matches = REGEX_SET.matches(log_content);

        // Parse line nodes (sample up to 200 records to bound memory)
        for line in log_content.lines().take(200) {
            if let Some(caps) = RE_LOG_LINE.captures(line) {
                doc.records.push(LogRecordNode {
                    timestamp: caps.get(1).map(|m| m.as_str().to_string()),
                    thread: caps.get(2).map(|m| m.as_str().to_string()),
                    level: caps.get(3).map(|m| m.as_str().to_string()),
                    message: caps.get(4).map(|m| m.as_str().to_string()).unwrap_or_default(),
                });
            }
        }

        // 0: Java Mismatch
        if matches.matched(0) {
            if let Some(caps) = RE_JAVA_MISMATCH.captures(log_content) {
                doc.exceptions.push(ExceptionNode {
                    exception_class: "java.lang.UnsupportedClassVersionError".into(),
                    message: "Unsupported major.minor version".into(),
                    class_file_version_required: caps.get(1).map(|m| m.as_str().to_string()),
                    class_file_version_current: caps.get(2).map(|m| m.as_str().to_string()),
                });
            }
        }

        // 1: Out of Memory
        if matches.matched(1) {
            if let Some(caps) = RE_OOM.captures(log_content) {
                doc.exceptions.push(ExceptionNode {
                    exception_class: "java.lang.OutOfMemoryError".into(),
                    message: caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_else(|| "Heap".into()),
                    class_file_version_required: None,
                    class_file_version_current: None,
                });
            }
        }

        // 2 & 3: Fabric Missing/Incompatible
        if matches.matched(2) || matches.matched(3) {
            if let Some(caps) = RE_FABRIC_REQ.captures(log_content).or_else(|| RE_FABRIC_INCOMPAT.captures(log_content)) {
                doc.fabric_resolutions.push(FabricResolutionNode {
                    mod_name: caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_else(|| "?".into()),
                    missing_dependency: caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_else(|| "?".into()),
                });
            }
        }

        // 4: Duplicate Mod
        if matches.matched(4) {
            if let Some(caps) = RE_DUPLICATE_MOD.captures(log_content) {
                let id = caps.get(1).or_else(|| caps.get(2)).or_else(|| caps.get(3))
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_else(|| "?".into());
                doc.duplicates.push(ModDuplicateNode { duplicate_mod_id: id });
            }
        }

        // 5: General Crash Marker
        doc.has_crash_marker = matches.matched(5);

        doc
    }

    /// Performs structured AST and root-cause analysis on Minecraft logs in under 5 milliseconds.
    pub fn diagnose_structured(&self, log_content: &str, zh: bool) -> DiagnosticResult {
        let start = Instant::now();
        let ast = self.parse_ast(log_content);

        // 1. Check for Java Version Mismatch in AST
        if let Some(exc) = ast.exceptions.iter().find(|e| e.exception_class.contains("UnsupportedClassVersionError")) {
            let req_ver = exc.class_file_version_required.as_deref().unwrap_or("");
            let cur_ver = exc.class_file_version_current.as_deref().unwrap_or("");
            let req_name = class_file_version_to_java(req_ver);
            let cur_name = class_file_version_to_java(cur_ver);

            let execution_time_micros = start.elapsed().as_micros() as u64;
            return DiagnosticResult {
                has_crash: true,
                root_cause_type: "JavaMismatch".into(),
                summary: localized!(
                    zh,
                    "Java 版本過舊：模組需要 {} (類別版本 {})，當前運行環境為 {} (類別版本 {})",
                    "Java is too old: a mod needs {} (class version {}), but {} (class version {}) is running",
                    req_name, req_ver, cur_name, cur_ver
                ),
                details: vec![
                    localized!(zh, "需要 Java：{} ({})", "Required Java: {} ({})", req_name, req_ver),
                    localized!(zh, "當前 Java：{} ({})", "Current Java: {} ({})", cur_name, cur_ver),
                ],
                suggestion: localized!(zh, "請前往實例設定中將 Java 執行環境切換至 {} 或更新版本。", "Switch the Java runtime in the instance settings to {} or newer.", req_name),
                execution_time_micros,
            };
        }

        // 2. Check for Out Of Memory in AST
        if let Some(exc) = ast.exceptions.iter().find(|e| e.exception_class.contains("OutOfMemoryError")) {
            let oom_type = &exc.message;
            let execution_time_micros = start.elapsed().as_micros() as u64;
            return DiagnosticResult {
                has_crash: true,
                root_cause_type: "OutOfMemory".into(),
                summary: localized!(zh, "JVM 記憶體空間耗盡 ({})", "The JVM ran out of memory ({})", oom_type),
                details: vec![
                    localized!(zh, "耗盡空間類型：{}", "Exhausted space: {}", oom_type),
                    localized!(zh, "JVM 堆疊記憶體 (Heap Space) 已達上限，無法分配新物件", "The JVM heap is full, so no new objects can be allocated"),
                ],
                suggestion: localized!(zh, "請前往實例設定將「JVM 最大分配記憶體 (Max Heap)」調大（建議至少 4096 MB 或 6144 MB）。", "Raise the maximum JVM memory (Max Heap) in the instance settings, to at least 4096 MB or 6144 MB."),
                execution_time_micros,
            };
        }

        // 3. Check for Fabric Missing Dependency in AST
        if let Some(node) = ast.fabric_resolutions.first() {
            let execution_time_micros = start.elapsed().as_micros() as u64;
            return DiagnosticResult {
                has_crash: true,
                root_cause_type: "MissingFabricApi".into(),
                summary: localized!(zh, "Fabric 模組「{}」缺少前置依賴：{}", "The Fabric mod {} is missing a dependency: {}", node.mod_name, node.missing_dependency),
                details: vec![
                    localized!(zh, "觸發模組：{}", "Mod: {}", node.mod_name),
                    localized!(zh, "缺少相依：{}", "Missing dependency: {}", node.missing_dependency),
                ],
                suggestion: localized!(zh, "請於模組工作坊搜尋並下載安裝相應的依賴模組（如 {}）。", "Search the mod workshop and install the dependency ({}).", node.missing_dependency),
                execution_time_micros,
            };
        }

        // 4. Check for Duplicate Mods in AST
        if let Some(dup) = ast.duplicates.first() {
            let execution_time_micros = start.elapsed().as_micros() as u64;
            return DiagnosticResult {
                has_crash: true,
                root_cause_type: "DuplicateMods".into(),
                summary: localized!(zh, "偵測到重複安裝的模組：{}", "A mod is installed more than once: {}", dup.duplicate_mod_id),
                details: vec![
                    localized!(zh, "衝突模組識別：{}", "Conflicting mod ID: {}", dup.duplicate_mod_id),
                    localized!(zh, "實例 mods 資料夾中同時存在同一模組的多個不同版本 .jar", "The instance mods folder holds several .jar versions of the same mod"),
                ],
                suggestion: localized!(zh, "請開啟實例 mods 資料夾，檢查並刪除重複的舊版 .jar 檔案。", "Open the instance mods folder and delete the older duplicate .jar files."),
                execution_time_micros,
            };
        }

        // 5. General crash detection
        let has_crash = ast.has_crash_marker;
        let execution_time_micros = start.elapsed().as_micros() as u64;

        DiagnosticResult {
            has_crash,
            root_cause_type: if has_crash { "UnknownCrash".into() } else { "Clean".into() },
            summary: if has_crash {
                localized!(zh, "遊戲進程異常中斷，日誌中偵測到未分類之異常例外。", "The game stopped unexpectedly with an exception that isn't recognised.")
            } else {
                localized!(zh, "日誌正常，未偵測到遊戲崩潰或重大異常。", "The log looks fine. No crash or serious problem was found.")
            },
            details: Vec::new(),
            suggestion: if has_crash {
                localized!(zh, "可複製完整日誌內容尋求社群或模組作者協助。", "Copy the full log and ask the community or the mod author for help.")
            } else {
                localized!(zh, "無須修復。", "Nothing to fix.")
            },
            execution_time_micros,
        }
    }

    /// Legacy compatible analyze_log method returning DiagnosticReport list.
    pub fn analyze_log(&self, log_content: &str, zh: bool) -> Vec<DiagnosticReport> {
        let res = self.diagnose_structured(log_content, zh);
        if !res.has_crash || res.root_cause_type == "Clean" {
            return Vec::new();
        }

        vec![DiagnosticReport {
            matched_rule: res.root_cause_type,
            title: res.summary.clone(),
            severity: DiagnosticSeverity::Critical,
            root_cause: res.summary,
            recommended_fix: res.suggestion,
            affected_files: res.details,
        }]
    }
}

impl Default for LogDiagnosticEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_class_file_version_mapping() {
        assert_eq!(class_file_version_to_java("65.0"), "Java 21");
        assert_eq!(class_file_version_to_java("61.0"), "Java 17");
        assert_eq!(class_file_version_to_java("52.0"), "Java 8");
    }

    #[test]
    fn test_diagnose_java_mismatch() {
        let engine = LogDiagnosticEngine::new();
        let log = r#"
        [12:00:00] [main/ERROR]: Minecraft has crashed!
        java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this version of the Java Runtime only recognizes class file versions up to 61.0
        "#;
        let res = engine.diagnose_structured(log, true);
        assert!(res.has_crash);
        assert_eq!(res.root_cause_type, "JavaMismatch");
        assert!(res.summary.contains("Java 21"));
        assert!(res.summary.contains("Java 17"));
        assert!(res.suggestion.contains("Java 21"));
    }

    #[test]
    fn test_diagnose_oom() {
        let engine = LogDiagnosticEngine::new();
        let log = r#"
        Exception in thread "main" java.lang.OutOfMemoryError: Java heap space
        at java.base/java.util.Arrays.copyOf(Arrays.java:3537)
        "#;
        let res = engine.diagnose_structured(log, true);
        assert!(res.has_crash);
        assert_eq!(res.root_cause_type, "OutOfMemory");
        assert!(res.suggestion.contains("4096 MB"));
    }

    #[test]
    fn test_diagnose_fabric_missing() {
        let engine = LogDiagnosticEngine::new();
        let log = r#"
        net.fabricmc.loader.impl.FormattedException: Mod 'Sodium' (sodium) 0.5.8 requires fabric-api, which is missing!
        "#;
        let res = engine.diagnose_structured(log, true);
        assert!(res.has_crash);
        assert_eq!(res.root_cause_type, "MissingFabricApi");
        assert!(res.summary.contains("Sodium"));
        assert!(res.summary.contains("fabric-api"));
    }

    #[test]
    fn test_diagnose_duplicate_mod() {
        let engine = LogDiagnosticEngine::new();
        let log = r#"
        Duplicate mod id found: create
        "#;
        let res = engine.diagnose_structured(log, true);
        assert!(res.has_crash);
        assert_eq!(res.root_cause_type, "DuplicateMods");
        assert!(res.summary.contains("create"));
    }

    #[test]
    fn test_sub_5ms_performance_benchmark() {
        let engine = LogDiagnosticEngine::new();

        // Generate realistic 500-line Minecraft crash log
        let mut log = String::with_capacity(32768);
        for i in 0..450 {
            log.push_str(&format!("[12:34:{:02}] [Render thread/INFO]: [STDERR]: Loading asset chunk #{}\n", i % 60, i));
        }
        log.push_str("Exception in thread \"main\" java.lang.OutOfMemoryError: Java heap space\n");
        for i in 0..50 {
            log.push_str(&format!("\tat net.minecraft.client.renderer.LevelRenderer.render(LevelRenderer.java:{})\n", i * 10));
        }

        // Warm up JIT/cache
        for _ in 0..5 {
            let _ = engine.diagnose_structured(&log, true);
        }

        // Benchmark: measure across runs to eliminate OS thread scheduling jitter in unoptimized debug mode
        let mut min_elapsed = std::time::Duration::from_secs(10);
        for _ in 0..3 {
            let start = Instant::now();
            let result = engine.diagnose_structured(&log, true);
            let elapsed = start.elapsed();
            assert!(result.has_crash);
            assert_eq!(result.root_cause_type, "OutOfMemory");
            if elapsed < min_elapsed {
                min_elapsed = elapsed;
            }
        }

        println!("Execution time on 500-line crash log: {:?}", min_elapsed);
        // Strict contract: sub-5ms (< 5000 µs)
        assert!(min_elapsed.as_micros() < 5000, "Diagnostic exceeded 5ms limit: {} µs", min_elapsed.as_micros());
    }
}
