import { readFileSync, existsSync, copyFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, ".env");
const envExample = join(__dirname, ".env.example");

// 检查依赖
try { await import("ethers"); } catch {
  console.error("依赖未安装，请先运行: bash install.sh 或 npm install");
  process.exit(1);
}

// 检查 .env
if (!existsSync(envPath)) {
  if (existsSync(envExample)) {
    copyFileSync(envExample, envPath);
    console.error(".env 文件不存在，已从 .env.example 创建，请编辑 .env 填入私钥后重新运行");
  } else {
    console.error(".env 文件不存在，请创建 .env 并填入 PRIVATE_KEY 或 SOL_PRIVATE_KEY");
  }
  process.exit(1);
}

import { Wallet } from "ethers";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

// 读取 .env
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const API = "https://api.backed.fi/xdrop/api/v1/xdrop-user";
const REFERRAL = "188888XX";
const RETRY = 3;
const RETRY_MS = 5000;
const INTERVAL_H = 2;
const SIGN = {
  REG: "By signing this message, I confirm wallet ownership and register for xPoints",
  SPIN: "Reveal daily spin multiplier",
};

// 钱包
let wallet, chain;
if (env.SOL_PRIVATE_KEY && !env.SOL_PRIVATE_KEY.includes("你的")) {
  const kp = Keypair.fromSecretKey(bs58.decode(env.SOL_PRIVATE_KEY));
  wallet = {
    address: kp.publicKey.toBase58(),
    signMessage: async (msg) => Buffer.from(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey)).toString("base64"),
  };
  chain = "Svm";
} else if (env.PRIVATE_KEY && !env.PRIVATE_KEY.includes("你的")) {
  const w = new Wallet(env.PRIVATE_KEY);
  wallet = { address: w.address, signMessage: (msg) => w.signMessage(msg) };
  chain = "Evm";
} else {
  console.error("请在 .env 中填入有效的 PRIVATE_KEY 或 SOL_PRIVATE_KEY");
  process.exit(1);
}

const headers = { "Content-Type": "application/json", Origin: "https://defi.xstocks.fi", Referer: "https://defi.xstocks.fi/" };

async function safeJson(resp) {
  const t = await resp.text();
  try { return JSON.parse(t); } catch { throw new Error(t.slice(0, 100)); }
}

async function retry(fn, label) {
  let last;
  for (let i = 0; i < RETRY; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < RETRY - 1) await new Promise(r => setTimeout(r, RETRY_MS)); }
  }
  console.log(`  ${label} 失败 (${RETRY}次): ${last.message}`);
  return null;
}

async function getUser() {
  const r = await fetch(`${API}/${wallet.address}`, { headers });
  if (r.status === 404) return null;
  const d = await safeJson(r); return d.success ? d.data : null;
}

async function register() {
  const sig = await wallet.signMessage(SIGN.REG);
  const r = await fetch(API, { method: "POST", headers, body: JSON.stringify({ walletAddress: wallet.address, walletType: chain, signature: sig, referredBy: REFERRAL }) });
  const d = await safeJson(r);
  if (!d.success) throw new Error(d.error || "注册失败");
  return d.data;
}

async function getDashboard() {
  const r = await fetch(`${API}/${wallet.address}/dashboard`, { headers });
  const d = await safeJson(r); return d.success ? d.data : null;
}

async function revealBoost() {
  const sig = await wallet.signMessage(SIGN.SPIN);
  const r = await fetch(`${API}/daily-spin-multiplier`, { method: "PUT", headers, body: JSON.stringify({ walletAddress: wallet.address, signature: sig }) });
  const d = await safeJson(r);
  if (!d.success) { if ((d.error || "").includes("limit reached")) return null; throw new Error(d.error || "转盘失败"); }
  return d.data;
}

function countdown(date) {
  const diff = new Date(date) - Date.now();
  if (diff <= 0) return "now";
  return `${Math.floor(diff / 3600000)}h${Math.floor((diff % 3600000) / 60000)}m`;
}

let lastTotalPoints;
let lastResetDate;
let todayPoints;

async function run() {
  console.log(`\n[${new Date().toLocaleString("zh-CN")}] 钱包: ${wallet.address}`);

  // 注册
  process.stdout.write("  正在检查注册状态...");
  const user = await retry(async () => {
    const u = await getUser();
    if (u) return u;
    process.stdout.write("\r  新钱包，正在注册...       ");
    const reg = await register();
    process.stdout.write("\r  新钱包，注册成功!         \n");
    return reg;
  }, "注册");
  if (!user) { console.log(); return; }
  process.stdout.write("\r  已注册                     \n");

  // 查询状态
  process.stdout.write("  正在查询账户状态...");
  const db = await retry(getDashboard, "查询");
  if (!db) { console.log(); return; }
  process.stdout.write("\r  查询完成                   \n");

  // 转盘
  if (!db.dailySpinMultiplierRevealed) {
    process.stdout.write("  正在转盘...");
    const boost = await retry(revealBoost, "转盘");
    if (boost) process.stdout.write(`\r  转盘: ${boost.dailySpinMultiplier}x              \n`);
    else process.stdout.write("\r  转盘: 失败                 \n");
  } else {
    console.log(`  转盘: 今日已转 (${db.dailySpinMultiplier}x)`);
  }

  // 查询最终状态
  const final = await retry(getDashboard, "查询");
  if (final) {
    // 跨过日结点（重置时间变化）→ 今日累计清零
    if (lastResetDate && final.nextSnapshotDate !== lastResetDate) {
      todayPoints = 0;
    }
    // 累加本轮增量到今日
    if (lastTotalPoints !== undefined) {
      const d = final.totalPoints - lastTotalPoints;
      if (d > 0) todayPoints = (todayPoints || 0) + d;
    }
    lastTotalPoints = final.totalPoints;
    lastResetDate = final.nextSnapshotDate;
    const todayStr = todayPoints === undefined ? "今日 -" : `今日 +${todayPoints}`;
    console.log(`\n  完成! 总积分: ${final.totalPoints} | ${todayStr} | 加成: ${final.xboostMultiplier || 1}x | 重置: ${countdown(final.nextSnapshotDate)}`);
  }
}

async function main() {
  console.log(`
  ================================================
    xStocks 自动转盘 | ${chain === "Svm" ? "Solana" : "EVM"}
  ------------------------------------------------
    制作人: 岳来岳会赚
    关注X: https://x.com/188888_x
    立享20%积分加成: https://defi.xstocks.fi/points?ref=188888XX
  ================================================
`);
  while (true) {
    await run();
    console.log(`\n等待 ${INTERVAL_H} 小时后再次执行...`);
    await new Promise(r => setTimeout(r, INTERVAL_H * 3600000));
  }
}

main();
