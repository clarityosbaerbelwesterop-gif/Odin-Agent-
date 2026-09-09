import { readFile } from "node:fs/promises";

async function source() {
  return readFile("src/chat/hosted.ts", "utf8");
}

let hosted = await source();
if (!hosted.includes('id: "muse-glimmer"')) {
  await import("./mno-product-patch.mjs");
  await import("./mno-product-postfix.mjs");
  await import("./mno-product-runtime-postfix.mjs");
  hosted = await source();
}
if (!hosted.includes('url.pathname === "/api/github/connect"')) {
  await import("./pqr-product-patch.mjs");
}
console.log("Product source prepared");
