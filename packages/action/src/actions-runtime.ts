import { appendFile, appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export interface ActionRuntime {
  readonly getInput: (name: string, options?: { readonly required?: boolean }) => string;
  readonly setOutput: (name: string, value: unknown) => void;
  readonly setFailed: (message: string) => void;
  readonly warning: (message: string) => void;
  readonly writeSummary: (markdown: string) => Promise<void>;
}

function commandValue(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function writeWorkflowFile(path: string, name: string, value: string): void {
  const delimiter = `observegate_${randomUUID()}`;
  appendFileSync(path, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, { encoding: "utf8" });
}

export const githubActionsRuntime: ActionRuntime = Object.freeze({
  getInput(name: string, options?: { readonly required?: boolean }) {
    const environmentName = `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`;
    const value = (process.env[environmentName] ?? "").trim();
    if (options?.required === true && value.length === 0) {
      throw new Error(`Input required and not supplied: ${name}`);
    }
    return value;
  },
  setOutput(name: string, value: unknown) {
    const text = String(value);
    const outputPath = process.env.GITHUB_OUTPUT;
    if (outputPath === undefined || outputPath.length === 0) {
      process.stdout.write(`::set-output name=${name}::${commandValue(text)}\n`);
      return;
    }
    writeWorkflowFile(outputPath, name, text);
  },
  setFailed(message: string) {
    process.stderr.write(`::error::${commandValue(message)}\n`);
    process.exitCode = 1;
  },
  warning(message: string) {
    process.stderr.write(`::warning::${commandValue(message)}\n`);
  },
  async writeSummary(markdown: string) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath === undefined || summaryPath.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      appendFile(summaryPath, markdown, { encoding: "utf8" }, (error) => {
        if (error === null) resolve();
        else reject(error);
      });
    });
  }
});
