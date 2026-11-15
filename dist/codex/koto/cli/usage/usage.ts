#!/usr/bin/env bun
import { run } from "./lib/cli.ts";
process.exitCode = await run(process.argv.slice(2));
