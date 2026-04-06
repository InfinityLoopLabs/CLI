import { applyCaseToValue } from "./case";
import type { PluginParseContext, Variables } from "../types";

export type TemplateValue = string | ((vars: Variables) => string);

const TEMPLATE_REGEX = /\$(\{)?([A-Za-z_]\w*)(\})?/g;

export function assertTemplateValue(
  value: unknown,
  field: string,
  context: PluginParseContext,
): TemplateValue {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "function") {
    return (variables: Variables) => {
      const result = value(variables);
      if (typeof result !== "string") {
        throw new Error(
          `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] field "${field}" function must return a string.`,
        );
      }
      return result;
    };
  }

  throw new Error(
    `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] field "${field}" must be a string or function.`,
  );
}

export function parseTemplateObjectArray(
  value: unknown,
  field: string,
  context: PluginParseContext,
): Record<string, TemplateValue>[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] field "${field}" must be an array.`,
    );
  }

  return value.map((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(
        `Config "${context.configPath}" commands["${context.commandKey}"][${context.stepIndex}] field "${field}" entry [${index}] must be an object.`,
      );
    }

    const dict = entry as Record<string, unknown>;
    const parsed: Record<string, TemplateValue> = {};
    for (const [key, rawValue] of Object.entries(dict)) {
      parsed[key] = assertTemplateValue(rawValue, `${field}[${index}].${key}`, context);
    }
    return parsed;
  });
}

export function renderTemplateValue(value: TemplateValue, variables: Variables): string {
  const raw = typeof value === "function" ? value(variables) : value;

  return raw.replace(TEMPLATE_REGEX, (match: string, openBrace: string | undefined, token: string, closeBrace: string | undefined) => {
    const hasBraces = Boolean(openBrace || closeBrace);
    if (openBrace && !closeBrace) {
      throw new Error(`Unclosed template placeholder in "${raw}" near ${match}`);
    }

    if (!hasBraces) {
      const direct = variables[token];
      if (direct !== undefined) {
        return direct;
      }
    }

    const normalizedKey = token.toLowerCase();
    const baseValue = variables[normalizedKey] ?? variables[token];
    if (baseValue === undefined) {
      throw new Error(`Variable "$${token}" is required but was not provided.`);
    }

    if (hasBraces) {
      return applyCaseToValue(token, baseValue);
    }

    return baseValue;
  });
}
