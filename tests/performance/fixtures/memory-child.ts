import { runMemoryScenario } from "./memory-scenario.ts";

const directory = process.argv[2];
if (directory === undefined) throw new Error("Memory scenario output directory is required.");

process.stdout.write(JSON.stringify(await runMemoryScenario(directory)));
