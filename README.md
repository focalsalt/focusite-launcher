# Focusite Launcher

A Minecraft launcher built with Tauri v2 (Rust) and React 19 + TypeScript + Tailwind CSS v4.

## Features

- Instances with Vanilla, Fabric, Forge, NeoForge, Quilt or a custom loader jar
- Import `.mrpack` / CurseForge `.zip` modpacks, or copy an instance from Prism Launcher / PCL
- Modrinth workshop for mods, resource packs, shaders and modpacks
- Microsoft account sign-in (tokens kept encrypted with DPAPI / the OS keyring)
- Theme packs: JSON files of `--fc-*` design tokens in `%APPDATA%\focusite_launcher\themes`
- Friend play: LAN world broadcast, plus a direct WebRTC tunnel set up with copy-and-paste invite and reply codes (no server)

## Where data lives

| What | Where |
| --- | --- |
| App data | `%APPDATA%\focusite_launcher` |
| Instances | `instances\` inside it, or the folder chosen in Global settings |
| Instance config | `focusite-instance.json` inside each instance (other launchers' files are never read) |
| Theme packs | `themes\*.focusite-theme.json` |

## Friend groups (signaling server)

Groups need a small signaling server that only relays connection data (game traffic goes peer to peer). It runs on Cloudflare Workers + Durable Objects, free plan included:

```bash
cd server/signaling
pnpm install
pnpm exec wrangler login
pnpm deploy
```

The worker is bound to `focusite-p2p.focalsalt.net` in `server/signaling/wrangler.toml` (the domain must be a zone in your Cloudflare account). Tell the launcher where it is with one line in `.env`, then restart the dev server or rebuild:

```
VITE_SIGNALING_URL=https://focusite-p2p.focalsalt.net
```

Create a group in the launcher and send the invite link to friends. The first launch also needs one click on "Allow firewall" (adds an inbound UDP allow rule for the launcher on private and domain networks; tunnels use UDP 47400-47499). If Windows labels your home Wi-Fi "Public", switch it to "Private".

## Development

Requirements: Node.js, [pnpm](https://pnpm.io), Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm tauri dev       # run the app
pnpm test            # frontend tests
pnpm build           # type-check and build the frontend
cargo test --workspace --manifest-path src-tauri/Cargo.toml
cargo clippy --workspace --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Microsoft login needs the Azure app's client ID. In development it is read from `MICROSOFT_CLIENT_ID` in `.env`; a release build bakes it in from the build environment, so set it before building:

```powershell
$env:MICROSOFT_CLIENT_ID = "<your Azure client ID>"; pnpm tauri build
```

## Layout

- `src/` – React UI (`views/`, `components/`, `services/` call the Rust commands, `i18n/` zh-TW and en-US)
- `src-tauri/` – Tauri app and commands
- `crates/` – `focusite-core`, `-auth`, `-download`, `-modpacks`, `-cas`, `-p2p`, `-diagnostic`
