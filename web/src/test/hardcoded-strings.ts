// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

import ts from 'typescript';

/** JSX attributes whose value a person reads or hears. */
const TEXT_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
]);

const HAS_LETTER = /\p{L}/u;

export interface Finding {
  line: number;
  text: string;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function isStringLiteral(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

/**
 * UI text written straight into JSX instead of going through `t()`: text between tags,
 * a string literal as a child (`{'Save'}`), or a literal in an attribute people read
 * (`aria-label="Close"`). Punctuation and whitespace alone are not text.
 */
export function findHardcodedStrings(fileName: string, code: string): Finding[] {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: Finding[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && HAS_LETTER.test(node.text)) {
      findings.push({ line: lineOf(source, node), text: node.text.trim() });
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      isStringLiteral(node.expression) &&
      !ts.isJsxAttribute(node.parent) &&
      HAS_LETTER.test(node.expression.text)
    ) {
      findings.push({ line: lineOf(source, node), text: node.expression.text });
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(source))) {
      const init = node.initializer;
      const literal =
        init && isStringLiteral(init)
          ? init
          : init && ts.isJsxExpression(init) && init.expression && isStringLiteral(init.expression)
            ? init.expression
            : undefined;
      if (literal && HAS_LETTER.test(literal.text)) {
        findings.push({ line: lineOf(source, node), text: literal.text });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return findings;
}

/** Every message key passed as a literal to `t('…')` or `translate(language, '…')`. */
export function findMessageKeys(fileName: string, code: string): { line: number; key: string }[] {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const keys: { line: number; key: string }[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      const arg =
        name === 't' ? node.arguments[0] : name === 'translate' ? node.arguments[1] : undefined;
      if (arg && isStringLiteral(arg)) keys.push({ line: lineOf(source, node), key: arg.text });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return keys;
}
