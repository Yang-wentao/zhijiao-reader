#!/usr/bin/env node
// 发码 / 管码命令行。在 mini 上 SSH 进来用：
//   node admin.mjs create --label 张三 --quota 3000000
//   node admin.mjs list
//   node admin.mjs disable ZJ-XXXX-XXXX-XXXX
//   node admin.mjs enable  ZJ-XXXX-XXXX-XXXX
//   node admin.mjs quota   ZJ-XXXX-XXXX-XXXX 5000000
//   node admin.mjs usage   ZJ-XXXX-XXXX-XXXX
import { loadEnv } from "./env.mjs";
import { CloudDb } from "./db.mjs";
import { loadConfigFromEnv } from "./server.mjs";

loadEnv();
const config = loadConfigFromEnv();
const db = new CloudDb(config.dbPath);

const DEFAULT_QUOTA = 3_000_000; // 每月 300 万 tokens，正常阅读用不完

function fmt(row) {
  const status = row.active ? "启用" : "停用";
  const used = `${row.used_tokens.toLocaleString()}/${row.quota_tokens.toLocaleString()}`;
  return `${row.code}  [${status}]  ${row.label || "(未命名)"}  本月已用 ${used} tokens  (${row.period})`;
}

function getFlag(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

const [, , command, ...args] = process.argv;

switch (command) {
  case "create": {
    const label = getFlag(args, "label", "");
    const quota = Number(getFlag(args, "quota", DEFAULT_QUOTA));
    const row = db.createCode({ label, quotaTokens: quota });
    console.log("已创建订阅码：\n" + fmt(row));
    break;
  }
  case "list": {
    const rows = db.listCodes();
    if (rows.length === 0) {
      console.log("还没有任何订阅码。用 create 创建一个。");
    } else {
      rows.forEach((row) => console.log(fmt(row)));
    }
    break;
  }
  case "disable":
  case "enable": {
    const code = args[0];
    if (!code) {
      console.error(`用法：node admin.mjs ${command} <订阅码>`);
      process.exit(1);
    }
    const ok = db.setActive(code, command === "enable");
    console.log(ok ? `已${command === "enable" ? "启用" : "停用"} ${code}` : "找不到这个订阅码。");
    break;
  }
  case "quota": {
    const [code, quota] = args;
    if (!code || !Number.isFinite(Number(quota))) {
      console.error("用法：node admin.mjs quota <订阅码> <每月token额度>");
      process.exit(1);
    }
    const ok = db.setQuota(code, Number(quota));
    console.log(ok ? `已把 ${code} 的额度调整为 ${Number(quota).toLocaleString()} tokens/月` : "找不到这个订阅码。");
    break;
  }
  case "usage": {
    const code = args[0];
    if (!code) {
      console.error("用法：node admin.mjs usage <订阅码>");
      process.exit(1);
    }
    const row = db.getCode(code);
    if (!row) {
      console.log("找不到这个订阅码。");
      break;
    }
    console.log(fmt(row));
    for (const entry of db.usageSummary(code)) {
      console.log(
        `  ${entry.kind}: ${entry.requests} 次，输入 ${entry.input_tokens.toLocaleString()}，输出 ${entry.output_tokens.toLocaleString()} tokens`,
      );
    }
    break;
  }
  default:
    console.log("命令：create | list | disable | enable | quota | usage（详见文件头注释）");
}

db.close();
