// Minimal stub of the `vscode` module for unit tests that import host code
// indirectly. Tests of pure modules (store, collectors) should not need this.
export const window = {
  createOutputChannel: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
};
export const workspace = {
  getConfiguration: () => ({
    get: <T>(_: string, fallback: T) => fallback,
  }),
};
export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => undefined,
};
export const Uri = {
  joinPath: (...parts: unknown[]) => ({ fsPath: parts.join('/') }),
  file: (p: string) => ({ fsPath: p }),
};
export const StatusBarAlignment = { Right: 2, Left: 1 } as const;
export class ThemeColor {
  constructor(public id: string) {}
}
export class MarkdownString {
  value: string;
  constructor(v: string) {
    this.value = v;
  }
}
