import { ChatError } from "./types.js";

/** Bounded arithmetic parser. Never evaluates JavaScript or model-provided code. */
export function calculate(expression: string): number {
  if (expression.length > 500 || !/^[\d\s.eE+*/%()^-]+$/u.test(expression))
    throw new ChatError("INVALID_EXPRESSION", "Use numbers, parentheses and arithmetic operators.");
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+*/%()^-]/gu) ?? [];
  if (!tokens.length || tokens.length > 200 || tokens.join("") !== expression.replace(/\s/gu, ""))
    throw new ChatError("INVALID_EXPRESSION", "Malformed arithmetic expression.");
  let position = 0;
  const parse = (minimum: number, depth: number): number => {
    if (depth > 32) throw new ChatError("EXPRESSION_LIMIT", "Arithmetic nesting limit reached.");
    const token = tokens[position++];
    let value: number;
    if (token === "-" || token === "+") value = (token === "-" ? -1 : 1) * parse(3, depth + 1);
    else if (token === "(") {
      value = parse(0, depth + 1);
      if (tokens[position++] !== ")")
        throw new ChatError("INVALID_EXPRESSION", "Unbalanced parentheses.");
    } else {
      value = Number(token);
      if (
        token === undefined ||
        !Number.isFinite(value) ||
        Math.abs(value) > Number.MAX_SAFE_INTEGER
      )
        throw new ChatError("INVALID_EXPRESSION", "Expected a finite number.");
    }
    while (position < tokens.length) {
      const operator = tokens[position] ?? "";
      const precedence =
        operator === "+" || operator === "-"
          ? 1
          : ["*", "/", "%"].includes(operator)
            ? 2
            : operator === "^"
              ? 3
              : -1;
      if (precedence < minimum) break;
      position++;
      const right = parse(precedence + (operator === "^" ? 0 : 1), depth + 1);
      if ((operator === "/" || operator === "%") && right === 0)
        throw new ChatError("DIVISION_BY_ZERO", "Division by zero is undefined.");
      if (operator === "+") value += right;
      else if (operator === "-") value -= right;
      else if (operator === "*") value *= right;
      else if (operator === "/") value /= right;
      else if (operator === "%") value %= right;
      else value **= right;
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
        throw new ChatError("PRECISION_LIMIT", "Calculation exceeds the supported numeric range.");
    }
    return value;
  };
  const result = parse(0, 0);
  if (position !== tokens.length)
    throw new ChatError("INVALID_EXPRESSION", "Unexpected trailing expression.");
  return result;
}
