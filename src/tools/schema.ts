import type { JsonObject, JsonValue } from "../providers/types.js";
import { ToolRuntimeError } from "./types.js";

const COMMON_KEYWORDS = new Set(["description", "enum", "type"]);
const OBJECT_KEYWORDS = new Set(["additionalProperties", "properties", "required"]);
const STRING_KEYWORDS = new Set(["maxLength", "minLength"]);
const NUMBER_KEYWORDS = new Set(["maximum", "minimum"]);
const ARRAY_KEYWORDS = new Set(["items", "maxItems", "minItems"]);

export function assertStrictToolSchema(schema: JsonObject): void {
  validateSchema(schema, "$", true);
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    invalid("Tool input schema root must be an object with additionalProperties=false.");
  }
  const properties = asRecord(schema.properties, "Tool input schema properties must be an object.");
  const required = schema.required;
  if (!Array.isArray(required) || !required.every((item) => typeof item === "string")) {
    invalid("Tool input schema required must be a string array.");
  }
  const propertyNames = Object.keys(properties);
  if (
    required.length !== propertyNames.length ||
    propertyNames.some((property) => !required.includes(property))
  ) {
    invalid("Strict tool input schemas must mark every property as required.");
  }
}

export function validateToolInput(schema: JsonObject, input: JsonObject): void {
  validateValue(schema, input, "$input");
}

function validateSchema(schema: JsonObject, path: string, root = false): void {
  const type = schema.type;
  if (
    type !== "object" &&
    type !== "string" &&
    type !== "number" &&
    type !== "integer" &&
    type !== "boolean" &&
    type !== "array" &&
    type !== "null"
  ) {
    invalid(`${path}: unsupported or missing schema type.`);
  }

  const allowed = new Set(COMMON_KEYWORDS);
  if (type === "object") for (const key of OBJECT_KEYWORDS) allowed.add(key);
  if (type === "string") for (const key of STRING_KEYWORDS) allowed.add(key);
  if (type === "number" || type === "integer") {
    for (const key of NUMBER_KEYWORDS) allowed.add(key);
  }
  if (type === "array") for (const key of ARRAY_KEYWORDS) allowed.add(key);

  for (const key of Object.keys(schema)) {
    if (!allowed.has(key)) invalid(`${path}: unsupported schema keyword ${key}.`);
  }

  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      invalid(`${path}: enum must be a non-empty array.`);
    }
  }

  if (type === "object") {
    if (schema.additionalProperties !== false) {
      invalid(`${path}: object schemas must set additionalProperties=false.`);
    }
    const properties = asRecord(schema.properties, `${path}: properties must be an object.`);
    const required = schema.required;
    if (!Array.isArray(required) || !required.every((item) => typeof item === "string")) {
      invalid(`${path}: required must be a string array.`);
    }
    if (new Set(required).size !== required.length) {
      invalid(`${path}: required must not contain duplicates.`);
    }
    for (const property of required) {
      if (!(property in properties)) invalid(`${path}: required property ${property} is undefined.`);
    }
    if (root && Object.keys(properties).some((property) => !required.includes(property))) {
      invalid(`${path}: strict root schemas must require every property.`);
    }
    for (const [property, child] of Object.entries(properties)) {
      validateSchema(asJsonObject(child, `${path}.${property}: property schema must be an object.`), `${path}.${property}`);
    }
  } else if (type === "string") {
    assertNonNegativeInteger(schema.minLength, `${path}: minLength`);
    assertNonNegativeInteger(schema.maxLength, `${path}: maxLength`);
    const minLength = optionalNumber(schema.minLength);
    const maxLength = optionalNumber(schema.maxLength);
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
      invalid(`${path}: minLength must not exceed maxLength.`);
    }
  } else if (type === "number" || type === "integer") {
    assertFiniteNumber(schema.minimum, `${path}: minimum`);
    assertFiniteNumber(schema.maximum, `${path}: maximum`);
    const minimum = optionalNumber(schema.minimum);
    const maximum = optionalNumber(schema.maximum);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      invalid(`${path}: minimum must not exceed maximum.`);
    }
  } else if (type === "array") {
    assertNonNegativeInteger(schema.minItems, `${path}: minItems`);
    assertNonNegativeInteger(schema.maxItems, `${path}: maxItems`);
    const minItems = optionalNumber(schema.minItems);
    const maxItems = optionalNumber(schema.maxItems);
    if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
      invalid(`${path}: minItems must not exceed maxItems.`);
    }
    validateSchema(asJsonObject(schema.items, `${path}: array items schema is required.`), `${path}[]`);
  }
}

function validateValue(schema: JsonObject, value: JsonValue, path: string): void {
  if (schema.enum !== undefined && !enumContains(schema.enum, value)) {
    invalid(`${path}: value is not in the allowed enum.`);
  }

  if (schema.type === "object") {
    if (!isJsonObject(value)) invalid(`${path}: expected object.`);
    const properties = asRecord(schema.properties, `${path}: schema properties missing.`);
    const required = schema.required as readonly string[];
    for (const property of required) {
      if (!(property in value)) invalid(`${path}.${property}: required property is missing.`);
    }
    for (const key of Object.keys(value)) {
      if (!(key in properties)) invalid(`${path}.${key}: unknown property.`);
      validateValue(
        asJsonObject(properties[key], `${path}.${key}: invalid property schema.`),
        value[key] as JsonValue,
        `${path}.${key}`,
      );
    }
    return;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") invalid(`${path}: expected string.`);
    const minLength = optionalNumber(schema.minLength);
    const maxLength = optionalNumber(schema.maxLength);
    if (minLength !== undefined && value.length < minLength) invalid(`${path}: string is too short.`);
    if (maxLength !== undefined && value.length > maxLength) invalid(`${path}: string is too long.`);
    return;
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${path}: expected number.`);
    if (schema.type === "integer" && !Number.isInteger(value)) invalid(`${path}: expected integer.`);
    const minimum = optionalNumber(schema.minimum);
    const maximum = optionalNumber(schema.maximum);
    if (minimum !== undefined && value < minimum) invalid(`${path}: number is below minimum.`);
    if (maximum !== undefined && value > maximum) invalid(`${path}: number exceeds maximum.`);
    return;
  }

  if (schema.type === "boolean") {
    if (typeof value !== "boolean") invalid(`${path}: expected boolean.`);
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) invalid(`${path}: expected array.`);
    const minItems = optionalNumber(schema.minItems);
    const maxItems = optionalNumber(schema.maxItems);
    if (minItems !== undefined && value.length < minItems) invalid(`${path}: array is too short.`);
    if (maxItems !== undefined && value.length > maxItems) invalid(`${path}: array is too long.`);
    const itemSchema = asJsonObject(schema.items, `${path}: array item schema missing.`);
    value.forEach((item, index) => validateValue(itemSchema, item, `${path}[${index}]`));
    return;
  }

  if (value !== null) invalid(`${path}: expected null.`);
}

function enumContains(rawEnum: JsonValue, value: JsonValue): boolean {
  if (!Array.isArray(rawEnum)) return false;
  return rawEnum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value));
}

function asRecord(value: JsonValue | undefined, message: string): Record<string, JsonValue> {
  if (!isJsonObject(value)) invalid(message);
  return value as Record<string, JsonValue>;
}

function asJsonObject(value: JsonValue | undefined, message: string): JsonObject {
  if (!isJsonObject(value)) invalid(message);
  return value;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function assertNonNegativeInteger(value: JsonValue | undefined, name: string): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${name} must be a non-negative safe integer.`);
  }
}

function assertFiniteNumber(value: JsonValue | undefined, name: string): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${name} must be finite.`);
}

function invalid(message: string): never {
  throw new ToolRuntimeError("invalid_input", message, false);
}
