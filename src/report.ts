/** Turning diagnostics into text a person reads. */

import { styleText } from "node:util";
import { countLevels, type Diagnostic } from "./types.ts";

export function colorEnabled(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (process.env["NO_COLOR"] !== undefined && process.env["NO_COLOR"] !== "") return false;
  if (process.env["FORCE_COLOR"] !== undefined && process.env["FORCE_COLOR"] !== "") return true;
  return stream.isTTY === true;
}

type Style = "red" | "yellow" | "dim" | "bold" | "cyan" | "green";

export function paint(style: Style | Style[], text: string, enabled = colorEnabled()): string {
  if (!enabled) return text;
  return styleText(style as never, text);
}

export function formatDiagnostic(item: Diagnostic, color = colorEnabled()): string {
  const where = item.line === null ? item.path : `${item.path}:${item.line}`;
  const code = paint(item.level === "error" ? "red" : "yellow", item.code, color);
  const field = item.field === null ? "" : `${paint("cyan", item.field, color)}: `;
  const head = `${where}: ${code} ${field}${item.message}`;
  if (item.hint === null) return head;
  return `${head}\n    ${paint("dim", `hint: ${item.hint}`, color)}`;
}

export function formatDiagnostics(list: Diagnostic[], color = colorEnabled()): string {
  return list.map((item) => formatDiagnostic(item, color)).join("\n");
}

export function summaryLine(list: Diagnostic[], filesChecked: number, color = colorEnabled()): string {
  const { errors, warnings } = countLevels(list);
  const text = `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"} in ${filesChecked} file${filesChecked === 1 ? "" : "s"}`;
  if (errors > 0) return paint("red", text, color);
  if (warnings > 0) return paint("yellow", text, color);
  return paint("green", text, color);
}
