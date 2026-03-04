#!/usr/bin/env node
"use strict";

const { version } = require("../package.json");
const { execSync } = require("child_process");
const { writeFileSync, chmodSync, mkdirSync, cpSync } = require("fs");
const { join } = require("path");

mkdirSync("dist", { recursive: true });

execSync(
  [
    "npx esbuild bin/nara-cli.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=dist/nara-cli-bundle.cjs",
    `--define:__CLI_VERSION__='"${version}"'`,
    "--external:snarkjs",
  ].join(" "),
  { stdio: "inherit" }
);

const wrapper = `#!/usr/bin/env node
const _w=console.warn;console.warn=(...a)=>{if(String(a[0]).includes("bigint"))return;_w(...a)};
try{process.loadEnvFile()}catch{}
require("./nara-cli-bundle.cjs");
`;
writeFileSync("dist/naracli.cjs", wrapper);
chmodSync("dist/naracli.cjs", "755");

// Copy ZK circuit files (wasm + zkey) needed at runtime by nara-sdk
const zkSrc = join(__dirname, "..", "node_modules", "nara-sdk", "src", "zk");
const zkDst = join(__dirname, "..", "dist", "zk");
cpSync(zkSrc, zkDst, { recursive: true });
