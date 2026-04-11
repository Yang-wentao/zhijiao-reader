import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const envPath = join(projectRoot, ".env");
const envExamplePath = join(projectRoot, ".env.example");
const nodeModulesPath = join(projectRoot, "node_modules");

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const configureOnly = args.has("--configure-only");
const nonInteractive = args.has("--non-interactive");

try {
  await ensureEnv();
  const env = parseEnv(await readFile(envPath, "utf8"));
  const readyEnv = await ensureProviderReady(env);

  if (!existsSync(nodeModulesPath)) {
    await runCommand(getNpmCommand(), ["install"], "Installing dependencies...");
  }

  if (checkOnly || configureOnly) {
    printSummary(readyEnv);
    process.exit(0);
  }

  printSummary(readyEnv);
  const child = spawn(getNpmCommand(), ["run", "dev"], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  setTimeout(() => {
    void openBrowser("http://localhost:5173");
  }, 2500);

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nStart failed: ${message}`);
  process.exit(1);
}

async function ensureEnv() {
  if (!existsSync(envPath)) {
    await mkdir(projectRoot, { recursive: true });
    await copyFile(envExamplePath, envPath);
    console.log("Created a local .env file from .env.example.");
  }
}

async function ensureProviderReady(currentEnv) {
  let env = { ...currentEnv };

  if (!env.AI_PROVIDER) {
    env.AI_PROVIDER = "codex";
  }

  if (needsConfiguration(env)) {
    if (nonInteractive) {
      throw new Error("Missing local configuration. Run `npm run configure` first.");
    }
    env = await configureEnvironment(env);
  }

  if (env.AI_PROVIDER === "codex" && !isCodexAvailable(env.CODEX_BIN || "codex")) {
    if (nonInteractive) {
      throw new Error("Codex CLI is not available in the current shell.");
    }
    console.log("\nLocal Codex CLI was not found. Switching provider is recommended.");
    env = await configureEnvironment(env, { forceProviderPrompt: true });
  }

  await writeEnv(env);
  return env;
}

function needsConfiguration(env) {
  if (env.AI_PROVIDER === "openai") {
    return !env.OPENAI_API_KEY;
  }
  if (env.AI_PROVIDER === "deepseek") {
    return !env.DEEPSEEK_API_KEY;
  }
  return false;
}

async function configureEnvironment(existingEnv, options = {}) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const env = {
      AI_PROVIDER: existingEnv.AI_PROVIDER || "codex",
      OPENAI_API_KEY: existingEnv.OPENAI_API_KEY || "",
      OPENAI_MODEL: existingEnv.OPENAI_MODEL || "gpt-4o",
      DEEPSEEK_API_KEY: existingEnv.DEEPSEEK_API_KEY || "",
      DEEPSEEK_MODEL: existingEnv.DEEPSEEK_MODEL || "deepseek-chat",
      CODEX_MODEL: existingEnv.CODEX_MODEL || "gpt-5.4-mini",
      CODEX_REASONING_EFFORT: existingEnv.CODEX_REASONING_EFFORT || "low",
      PORT: existingEnv.PORT || "8787",
      CODEX_BIN: existingEnv.CODEX_BIN || "codex",
    };

    const providerAnswer = await rl.question(
      `Provider [codex/deepseek/openai] (${env.AI_PROVIDER}): `,
    );
    const chosenProvider = (providerAnswer.trim() || env.AI_PROVIDER).toLowerCase();
    if (["codex", "deepseek", "openai"].includes(chosenProvider)) {
      env.AI_PROVIDER = chosenProvider;
    } else if (options.forceProviderPrompt) {
      env.AI_PROVIDER = "deepseek";
    }

    if (env.AI_PROVIDER === "codex") {
      env.CODEX_BIN = (await rl.question(`Codex binary (${env.CODEX_BIN}): `)).trim() || env.CODEX_BIN;
      env.CODEX_MODEL = (await rl.question(`Codex model (${env.CODEX_MODEL}): `)).trim() || env.CODEX_MODEL;
      env.CODEX_REASONING_EFFORT =
        (await rl.question(`Codex reasoning [low/medium/high] (${env.CODEX_REASONING_EFFORT}): `)).trim() ||
        env.CODEX_REASONING_EFFORT;
    }

    if (env.AI_PROVIDER === "deepseek") {
      env.DEEPSEEK_API_KEY =
        (await rl.question(`DeepSeek API key${env.DEEPSEEK_API_KEY ? " (press Enter to keep current)" : ""}: `))
          .trim() || env.DEEPSEEK_API_KEY;
      env.DEEPSEEK_MODEL =
        (await rl.question(`DeepSeek model (${env.DEEPSEEK_MODEL}): `)).trim() || env.DEEPSEEK_MODEL;
    }

    if (env.AI_PROVIDER === "openai") {
      env.OPENAI_API_KEY =
        (await rl.question(`OpenAI API key${env.OPENAI_API_KEY ? " (press Enter to keep current)" : ""}: `)).trim() ||
        env.OPENAI_API_KEY;
      env.OPENAI_MODEL = (await rl.question(`OpenAI model (${env.OPENAI_MODEL}): `)).trim() || env.OPENAI_MODEL;
    }

    return env;
  } finally {
    rl.close();
  }
}

function parseEnv(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    env[key] = value;
  }
  return env;
}

async function writeEnv(env) {
  const content = [
    `AI_PROVIDER=${env.AI_PROVIDER || "codex"}`,
    `OPENAI_API_KEY=${env.OPENAI_API_KEY || ""}`,
    `OPENAI_MODEL=${env.OPENAI_MODEL || "gpt-4o"}`,
    `DEEPSEEK_API_KEY=${env.DEEPSEEK_API_KEY || ""}`,
    `DEEPSEEK_MODEL=${env.DEEPSEEK_MODEL || "deepseek-chat"}`,
    `CODEX_MODEL=${env.CODEX_MODEL || "gpt-5.4-mini"}`,
    `CODEX_REASONING_EFFORT=${env.CODEX_REASONING_EFFORT || "low"}`,
    `PORT=${env.PORT || "8787"}`,
    `CODEX_BIN=${env.CODEX_BIN || "codex"}`,
    "",
  ].join("\n");
  await writeFile(envPath, content, "utf8");
}

function isCodexAvailable(binary) {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, [binary], {
    cwd: projectRoot,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function runCommand(command, commandArgs, label) {
  console.log(`\n${label}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with code ${code ?? "unknown"}.`));
      }
    });
    child.on("error", reject);
  });
}

function printSummary(env) {
  console.log("\nCodex Paper Reader");
  console.log(`- Provider: ${env.AI_PROVIDER}`);
  if (env.AI_PROVIDER === "codex") {
    console.log(`- Codex CLI: ${isCodexAvailable(env.CODEX_BIN || "codex") ? "detected" : "missing"}`);
    console.log(`- Model: ${env.CODEX_MODEL || "gpt-5.4-mini"} / ${env.CODEX_REASONING_EFFORT || "low"}`);
  }
  if (env.AI_PROVIDER === "deepseek") {
    console.log(`- DeepSeek key: ${env.DEEPSEEK_API_KEY ? "configured" : "missing"}`);
    console.log(`- Model: ${env.DEEPSEEK_MODEL || "deepseek-chat"}`);
  }
  if (env.AI_PROVIDER === "openai") {
    console.log(`- OpenAI key: ${env.OPENAI_API_KEY ? "configured" : "missing"}`);
    console.log(`- Model: ${env.OPENAI_MODEL || "gpt-4o"}`);
  }
}

async function openBrowser(url) {
  const commands =
    process.platform === "darwin"
      ? [["open", [url]]]
      : process.platform === "win32"
        ? [["cmd", ["/c", "start", "", url]]]
        : [["xdg-open", [url]]];

  for (const [command, commandArgs] of commands) {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }
}
