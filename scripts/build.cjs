#!/usr/bin/env node
"use strict";

const { version } = require("../package.json");
const { execSync } = require("child_process");
const { writeFileSync, chmodSync, mkdirSync } = require("fs");

mkdirSync("dist", { recursive: true });

execSync(
  [
    "npx esbuild bin/nara-cli.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--outfile=dist/nara-cli-bundle.cjs",
    `--define:__CLI_VERSION__='"${version}"'`,
    "--external:@solana/web3.js",
    "--external:@solana/spl-token",
    "--external:@coral-xyz/anchor",
    "--external:bip39",
    "--external:bs58",
    "--external:bn.js",
    "--external:commander",
    "--external:ed25519-hd-key",
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
