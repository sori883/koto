#!/usr/bin/env bun
import { main } from "./lib/cli.ts";

process.exitCode = await main(process.argv.slice(2));
