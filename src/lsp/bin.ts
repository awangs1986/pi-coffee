#!/usr/bin/env node
import { runCoffeeLsp } from "./cli.js";
import { runLspDaemon } from "./daemon.js";

if (process.argv[2] === "__daemon") {
  const socket = process.argv[3];
  if (!socket) throw new Error("daemon socket path is required");
  const configuredIdle = Number(process.env.PI_COFFEE_LSP_IDLE_MS);
  await runLspDaemon(socket, Number.isSafeInteger(configuredIdle) && configuredIdle > 0 ? configuredIdle : undefined);
} else {
  const code = await runCoffeeLsp(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
  process.exitCode = code;
}
