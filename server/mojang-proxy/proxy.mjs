// Asks the Mojang session server whether a launcher joined a challenge. Mojang refuses requests from Cloudflare's
// addresses, so the signaling Worker calls this tiny server instead; run it on any ordinary host (a VPS, Fly.io, ...).
//
//   KEY=<long random string> PORT=8787 node proxy.mjs
//
// Then give the Worker the same values:  wrangler secret put VERIFY_KEY   and   VERIFY_URL = "https://<this host>" in [vars].

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const KEY = process.env.KEY ?? "";
const PORT = Number(process.env.PORT ?? 8787);
if (KEY.length < 24) throw new Error("Set KEY to a random string of at least 24 characters");

const sameKey = (given) => {
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${KEY}`);
  return a.length === b.length && timingSafeEqual(a, b);
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://proxy");
  const username = url.searchParams.get("username") ?? "";
  const serverId = url.searchParams.get("serverId") ?? "";
  if (url.pathname !== "/has-joined" || !sameKey(req.headers.authorization ?? "")) {
    res.writeHead(404).end();
    return;
  }
  // Only what the session server accepts is forwarded, so this cannot be used as an open proxy.
  if (!/^\w{1,16}$/.test(username) || !/^[a-f0-9]{32}$/.test(serverId)) {
    res.writeHead(400).end();
    return;
  }
  try {
    const upstream = await fetch(
      `https://sessionserver.mojang.com/session/minecraft/hasJoined?${new URLSearchParams({ username, serverId })}`,
      { signal: AbortSignal.timeout(8000) },
    );
    res.writeHead(upstream.status, { "Content-Type": "application/json" }).end(await upstream.text());
  } catch {
    res.writeHead(502).end();
  }
}).listen(PORT, () => console.log(`mojang proxy listening on ${PORT}`));
