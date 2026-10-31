#!/usr/bin/env bun
import { main } from "./lib/cli.ts";

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
