import * as vscode from 'vscode';
import { execFile, spawn } from 'node:child_process';

const OLLAMA_INSTALL_URL = 'https://ollama.com/download';
const BOOTSTRAP_DONE_KEY = 'agentTab.ollama.bootstrap.done.v1';

const RECOMMENDED_MODELS = [
  { label: 'qwen2.5-coder:1.5b', detail: '~1 GB, fastest local coding option' },
  { label: 'llama3.2:3b', detail: '~2 GB, stronger general-purpose quality' },
  { label: 'gemma3:4b', detail: '~3 GB, balanced speed and quality' }
] as const;

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

function execFileSafe(file: string, args: string[], timeoutMs = 15000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(file, args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
      const code = typeof (error as any)?.code === 'number' ? (error as any).code : 0;
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code });
    });

    child.on('error', () => resolve({ stdout: '', stderr: 'failed to start process', code: 1 }));
  });
}

export class OllamaBootstrap {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  async maybeRunOnStartup(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('agentTab');
    const enabled = cfg.get<boolean>('ollama.bootstrapOnStartup', true);
    const alreadyDone = this.ctx.globalState.get<boolean>(BOOTSTRAP_DONE_KEY, false);
    if (!enabled || alreadyDone) return;

    await this.runWizard({ startup: true });
  }

  async runWizard(opts: { startup: boolean }): Promise<void> {
    const shouldContinue = await this.confirmStart(opts.startup);
    if (!shouldContinue) return;

    const installed = await this.hasOllamaInstalled();
    if (!installed) {
      const choice = await vscode.window.showWarningMessage(
        'Ollama is not installed. Install it to use free local models.',
        'Open Install Page',
        'Later'
      );
      if (choice === 'Open Install Page') {
        await vscode.env.openExternal(vscode.Uri.parse(OLLAMA_INSTALL_URL));
      }
      return;
    }

    const selectedModel = await this.pickModel();
    if (!selectedModel) return;

    const hasModel = await this.modelExists(selectedModel);
    if (!hasModel) {
      const pulled = await this.pullModel(selectedModel);
      if (!pulled) return;
    }

    await this.applyDefaults(selectedModel);
    await this.ctx.globalState.update(BOOTSTRAP_DONE_KEY, true);
    void vscode.window.showInformationMessage(`Local model ready: ${selectedModel}`);
  }

  private async confirmStart(startup: boolean): Promise<boolean> {
    if (!startup) return true;

    const choice = await vscode.window.showInformationMessage(
      'Set up a free local model with Ollama for Agent Tab?',
      'Set Up',
      'Not Now',
      'Never Ask Again'
    );

    if (choice === 'Never Ask Again') {
      await this.ctx.globalState.update(BOOTSTRAP_DONE_KEY, true);
      return false;
    }

    return choice === 'Set Up';
  }

  private async hasOllamaInstalled(): Promise<boolean> {
    const result = await execFileSafe('ollama', ['--version']);
    return result.code === 0;
  }

  private async pickModel(): Promise<string | undefined> {
    const configured = vscode.workspace.getConfiguration('agentTab').get<string>('ollama.bootstrapModel', 'qwen2.5-coder:1.5b');

    const options: vscode.QuickPickItem[] = RECOMMENDED_MODELS.map((m) => ({
      label: m.label,
      description: m.label === configured ? 'configured default' : undefined,
      detail: m.detail
    }));

    const choice = await vscode.window.showQuickPick(options, {
      placeHolder: 'Choose a local model to pull (one-time download)'
    });

    return choice?.label;
  }

  private async modelExists(model: string): Promise<boolean> {
    const result = await execFileSafe('ollama', ['list']);
    if (result.code !== 0) return false;

    const lines = result.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    return lines.some((line) => line.toLowerCase().startsWith(model.toLowerCase() + ' '));
  }

  private async pullModel(model: string): Promise<boolean> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Pulling ${model}`,
        cancellable: true
      },
      (progress, token) => {
        return new Promise<boolean>((resolve) => {
          let lastPercent = 0;
          let finished = false;

          const child = spawn('ollama', ['pull', model], {
            stdio: ['ignore', 'pipe', 'pipe']
          });

          const updateProgress = (text: string) => {
            const pctMatch = text.match(/(\d{1,3})%/);
            if (pctMatch) {
              const pct = Math.max(0, Math.min(100, Number(pctMatch[1])));
              if (pct > lastPercent) {
                progress.report({ increment: pct - lastPercent, message: `${pct}%` });
                lastPercent = pct;
              }
            } else {
              progress.report({ message: text.slice(0, 80) });
            }
          };

          child.stdout?.on('data', (buf: Buffer) => {
            updateProgress(String(buf).replace(/\s+/g, ' ').trim());
          });

          child.stderr?.on('data', (buf: Buffer) => {
            updateProgress(String(buf).replace(/\s+/g, ' ').trim());
          });

          token.onCancellationRequested(() => {
            child.kill();
            finished = true;
            void vscode.window.showWarningMessage('Model pull canceled.');
            resolve(false);
          });

          child.on('error', () => {
            if (finished) return;
            finished = true;
            void vscode.window.showErrorMessage('Failed to start `ollama pull`.');
            resolve(false);
          });

          child.on('close', (code) => {
            if (finished) return;
            finished = true;
            if (code === 0) {
              if (lastPercent < 100) {
                progress.report({ increment: 100 - lastPercent, message: '100%' });
              }
              resolve(true);
              return;
            }
            void vscode.window.showErrorMessage('Model download failed. Make sure Ollama is running and try again.');
            resolve(false);
          });
        });
      }
    );
  }

  private async applyDefaults(model: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('agentTab');
    await cfg.update('defaultProvider', 'ollama', vscode.ConfigurationTarget.Global);
    await cfg.update('defaultModel', model, vscode.ConfigurationTarget.Global);
    await cfg.update('ollama.defaultModel', model, vscode.ConfigurationTarget.Global);
  }
}
