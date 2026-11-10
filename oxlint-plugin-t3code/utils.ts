import type { ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

type ExpressionWrapper =
  | ESTree.ChainExpression
  | ESTree.ParenthesizedExpression
  | ESTree.TSNonNullExpression
  | ESTree.TSAsExpression
  | ESTree.TSTypeAssertion;

type AstNode = ESTree.Node;

const asAstNode = (node: unknown): Option.Option<AstNode> =>
  typeof node === "object" && node !== null && "type" in node && typeof node.type === "string"
    ? Option.some(node as AstNode)
    : Option.none();

const isExpressionWrapper = (node: AstNode): node is ExpressionWrapper =>
  node.type === "ChainExpression" ||
  node.type === "ParenthesizedExpression" ||
  node.type === "TSNonNullExpression" ||
  node.type === "TSAsExpression" ||
  node.type === "TSTypeAssertion";

export function unwrapExpression(node: unknown): Option.Option<AstNode> {
  let current = asAstNode(node);

  while (Option.isSome(current) && isExpressionWrapper(current.value)) {
    current = asAstNode(current.value.expression);
  }

  return current;
}

export function getPropertyName(node: unknown): Option.Option<string> {
  return Option.flatMap(asAstNode(node), (expression) => {
    if (expression.type === "Identifier" && typeof expression.name === "string") {
      return Option.some(expression.name);
    }
    if (expression.type === "PrivateIdentifier" && typeof expression.name === "string") {
      return Option.some(expression.name);
    }
    if (expression.type === "Literal" && typeof expression.value === "string") {
      return Option.some(expression.value);
    }
    return Option.none();
  });
}

export function isIdentifier(node: Option.Option<AstNode>, name?: string): boolean {
  if (Option.isNone(node)) return false;
  const expression = node.value;
  return (
    expression.type === "Identifier" &&
    typeof expression.name === "string" &&
    (name === undefined || expression.name === name)
  );
}

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
// The scenario harness and the mock agent; their rules are in `.agents/rules/scenarios.md`.
const E2E_FILE_PATTERN = /(?:^|\/)scripts\/(?:scenarios|mock-agent)\/.+\.[cm]?[jt]sx?$/u;
const PERF_SCENARIO_PATTERN = /\.perf\.[cm]?[jt]s$/u;

export type TestFileKind = "test" | "e2e" | "perf";

/** Which kind of test file the test-wait rules see, if any. */
export function testFileKind(filename: string): Option.Option<TestFileKind> {
  const path = filename.replaceAll("\\", "/");
  if (TEST_FILE_PATTERN.test(path)) return Option.some("test");
  if (!E2E_FILE_PATTERN.test(path)) return Option.none();
  return Option.some(PERF_SCENARIO_PATTERN.test(path) ? "perf" : "e2e");
}
