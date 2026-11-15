fn main() {
    // The release build overflows Windows' default 1 MiB main-thread stack during startup
    // (large Tauri handler table + webrtc futures); reserve 8 MiB.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-bins=/STACK:8388608");
    }
    tauri_build::build()
}
