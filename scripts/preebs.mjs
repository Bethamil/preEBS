#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_URL = "http://localhost:3000";

function usage() {
  return `PreEBS CLI

Usage:
  preebs config [--url URL]
  preebs weeks [--url URL]
  preebs week --date YYYY-MM-DD [--url URL]
  preebs book --date YYYY-MM-DD --project ID --task ID --hours NUMBER [options]

Book options:
  --hour-type ID   Required only if the task has multiple hour types
  --note TEXT      Set the row note
  --url URL        PreEBS server (default: PREEBS_URL or ${DEFAULT_URL})

All successful commands print JSON. Booking sets the hours for that date and
combination; it does not add to existing hours, so retries are safe.`;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const key = argument.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function required(options, name) {
  const value = options[name];
  if (!value) {
    throw new Error(`Missing required option --${name}`);
  }
  return value;
}

async function resolveBaseUrl(explicitUrl) {
  if (explicitUrl || process.env.PREEBS_URL) {
    return explicitUrl ?? process.env.PREEBS_URL;
  }

  const connectionFiles = process.platform === "darwin"
    ? ["PreEBS", "preebs"].map((name) =>
        path.join(os.homedir(), "Library", "Application Support", name, "cli-connection.json"),
      )
    : [];
  for (const file of connectionFiles) {
    try {
      const connection = JSON.parse(await readFile(file, "utf-8"));
      if (typeof connection.url === "string" && connection.url) {
        return connection.url;
      }
    } catch (error) {
      if (error instanceof SyntaxError || (error && error.code !== "ENOENT")) {
        throw new Error(`Could not read desktop connection file ${file}`);
      }
    }
  }
  return DEFAULT_URL;
}

async function request(baseUrl, path, init) {
  let response;
  try {
    response = await fetch(new URL(path, `${baseUrl.replace(/\/$/, "")}/`), init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach PreEBS at ${baseUrl}: ${message}`);
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? body.error : body;
    throw new Error(`PreEBS returned ${response.status}: ${message || response.statusText}`);
  }
  return body;
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    return;
  }

  const baseUrl = await resolveBaseUrl(options.url);
  let result;
  if (command === "config") {
    result = await request(baseUrl, "/api/config");
  } else if (command === "weeks") {
    result = await request(baseUrl, "/api/weeks");
  } else if (command === "week") {
    result = await request(baseUrl, `/api/weeks/${encodeURIComponent(required(options, "date"))}`);
  } else if (command === "book") {
    const hoursValue = required(options, "hours").replace(",", ".");
    const hours = Number(hoursValue);
    if (!Number.isFinite(hours)) {
      throw new Error("--hours must be a number");
    }
    result = await request(baseUrl, "/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: required(options, "date"),
        projectId: required(options, "project"),
        taskId: required(options, "task"),
        hourTypeId: options["hour-type"],
        hours,
        note: options.note,
      }),
    });
  } else {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
