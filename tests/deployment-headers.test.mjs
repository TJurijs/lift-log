import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hosted dev permits its own preview frame while production disallows framing", async () => {
  const config = await readFile(new URL("../deploy/nginx-liftlog.conf", import.meta.url), "utf8");
  const servers = config.split(/(?=^server \{)/mu);
  const dev = servers.find((server) => server.includes("server_name dev.liftlog.cc;"));
  const production = servers.find((server) => server.includes("server_name app.liftlog.cc liftlog.cc www.liftlog.cc;"));
  assert.ok(dev, "Development server configuration must exist");
  assert.ok(production, "Production server configuration must exist");
  assert.match(dev, /add_header X-Frame-Options "SAMEORIGIN" always;/u);
  assert.match(production, /add_header X-Frame-Options "DENY" always;/u);
});
