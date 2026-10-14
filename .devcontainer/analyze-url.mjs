#!/usr/bin/env node
// Launch a disposable Chromium in Codespaces, then run the real REA CLI.
import { spawn } from "node:child_process";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const input = process.argv[2];
if (!input) { console.error("Uso: node .devcontainer/analyze-url.mjs https://exemplo.com"); process.exit(1); }
let url;
try { url = new URL(input); if (!["https:", "http:"].includes(url.protocol)) throw Error(); }
catch { console.error("Informe uma URL http:// ou https:// válida."); process.exit(1); }

const cache = join(homedir(), ".cache", "ms-playwright");
let browser;
try {
  const dirs = (await readdir(cache)).filter(n => /^chromium-\d+$/.test(n)).sort((a,b)=>Number(b.split("-")[1])-Number(a.split("-")[1]));
  for (const d of dirs) {
    const candidates = [join(cache,d,"chrome-linux64","chrome"),join(cache,d,"chrome-linux","chrome")];
    for (const c of candidates) {
      try { const { access } = await import("node:fs/promises"); await access(c); browser=c; break; } catch {}
    }
    if(browser) break;
  }
} catch {}
if (!browser) { console.error("Chromium ausente. Aguarde a instalação inicial do Codespace ou execute: npx playwright install --with-deps chromium"); process.exit(1); }

const chrome = spawn(browser, ["--headless","--no-sandbox","--disable-gpu","--disable-dev-shm-usage","--password-store=basic","--remote-allow-origins=*","--remote-debugging-port=9222","--user-data-dir=/tmp/rea-codespace-browser-"+process.pid,url.href], {stdio:"ignore"});
const cleanup = () => { if (!chrome.killed) chrome.kill("SIGTERM"); };
process.on("SIGINT",()=>{cleanup();process.exit(130)});process.on("exit",cleanup);
const endpoint = "http://127.0.0.1:9222";
let target;
for (let i=0;i<45;i++) {
  await new Promise(r=>setTimeout(r,1000));
  try {
    const targets = await (await fetch(endpoint+"/json/list")).json();
    target = targets.find(t=>t.type==="page" && t.url.startsWith(url.origin)) ?? targets.find(t=>t.type==="page" && t.url===url.href);
    if (target) break;
  } catch {}
}
if (!target) { console.error("Chromium não abriu a página; verifique a URL.");cleanup();process.exit(1); }
await mkdir("rea-reports",{recursive:true});
const run = (cmd, args) => new Promise((resolve,reject)=>{
  const chunks=[]; const p=spawn(cmd,args,{stdio:["ignore","pipe","pipe"]});
  p.stdout.on("data",x=>chunks.push(x));
  p.stderr.on("data",x=>process.stderr.write(x));
  p.on("error",reject);p.on("close",code=>resolve({code,body:Buffer.concat(chunks).toString()}));
});
console.log("Alvo:",target.url,"ID:",target.id);
const stamp = new Date().toISOString().replace(/[:.]/g,"-");
for(const [name,args] of [
  ["inspect-web-page",["--observation-ms","1000"]],
  ["analyze-web-bundle",[]]
]){
  console.log("Executando REA original:",name);
  const result=await run("rea",[name,endpoint,target.id,...args,"--json"]);
  const file="rea-reports/"+stamp+"-"+name+".json";
  await writeFile(file,result.body);
  console.log("Resultado:",file,"código:",result.code);
  if(result.code!==0) console.log(result.body.slice(0,1200));
}
cleanup();
