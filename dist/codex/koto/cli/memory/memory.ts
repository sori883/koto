#!/usr/bin/env bun
import { run } from "./lib/cli.ts";
process.exitCode = await run(Bun.argv.slice(2));
