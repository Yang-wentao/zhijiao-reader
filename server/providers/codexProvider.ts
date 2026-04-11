import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReasoningEffort } from "../config.js";
import { buildCodexAskPrompt, buildCodexTranslationPrompt } from "./codexPrompts.js";
import type { AIProvider, AskInput, TranslationInput } from "./types.js";

type CodexProviderOptions = {
  codexBin: string;
  cwd: string;
  model: string;
  reasoningEffort: ReasoningEffort;
};

export class CodexProvider implements AIProvider {
  private codexBin: string;
  private cwd: string;
  private model: string;
  private reasoningEffort: ReasoningEffort;

  constructor(options: CodexProviderOptions) {
    this.codexBin = options.codexBin;
    this.cwd = options.cwd;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort;
  }

  async streamTranslation(input: TranslationInput): Promise<AsyncIterable<string>> {
    const prompt = buildCodexTranslationPrompt(input);
    return this.runPrompt(prompt);
  }

  async streamAnswer(input: AskInput): Promise<AsyncIterable<string>> {
    const prompt = buildCodexAskPrompt(input);
    return this.runPrompt(prompt);
  }

  private async runPrompt(prompt: string): Promise<AsyncIterable<string>> {
    const outputFile = path.join(
      os.tmpdir(),
      `zhijiao-reader-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );

    try {
      await runCodexExec(
        this.codexBin,
        [
          "-a",
          "never",
          "exec",
          "--json",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "-m",
          this.model,
          "-c",
          `model_reasoning_effort="${this.reasoningEffort}"`,
          "--output-last-message",
          outputFile,
          prompt,
        ],
        this.cwd,
      );

      const output = await fs.readFile(outputFile, "utf8");
      return singleChunk(output.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Codex CLI request failed.";
      throw new Error(`Codex provider failed: ${message}`);
    } finally {
      await fs.rm(outputFile, { force: true });
    }
  }

  setModel(model: string) {
    this.model = model;
  }

  setReasoningEffort(reasoningEffort: ReasoningEffort) {
    this.reasoningEffort = reasoningEffort;
  }
}

async function runCodexExec(codexBin: string, args: string[], cwd: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(codexBin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex CLI timed out after 180 seconds."));
    }, 180000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        resolve();
        return;
      }
      const diagnostics = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
      const suffix = diagnostics ? ` ${diagnostics}` : "";
      reject(new Error(`Codex CLI exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.${suffix}`));
    });
  });
}

async function* singleChunk(text: string): AsyncIterable<string> {
  if (text) {
    yield text;
  }
}
