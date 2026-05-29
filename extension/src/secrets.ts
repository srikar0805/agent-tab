import * as vscode from 'vscode';

const KEY = (p: string) => `agentTab.apiKey.${p}`;

export class Secrets {
  constructor(private store: vscode.SecretStorage) {}

  set(provider: string, value: string) {
    return this.store.store(KEY(provider), value);
  }

  get(provider: string) {
    return this.store.get(KEY(provider));
  }

  delete(provider: string) {
    return this.store.delete(KEY(provider));
  }
}
