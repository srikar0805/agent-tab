import * as vscode from 'vscode';
import { ChatViewProvider } from './chatViewProvider';
import { Secrets } from './secrets';
import { BudgetTracker } from './budget';
import { ConversationStore } from './state';
import { OllamaBootstrap } from './ollamaBootstrap';

export async function activate(context: vscode.ExtensionContext) {
  const secrets = new Secrets(context.secrets);
  const budget = new BudgetTracker(context.globalState);
  const conv = new ConversationStore(context.globalState);
  const provider = new ChatViewProvider(context, secrets, budget, conv);
  const ollamaBootstrap = new OllamaBootstrap(context);

  void ollamaBootstrap.maybeRunOnStartup();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),

    vscode.commands.registerCommand('agentTabChat.open', async () => {
      await vscode.commands.executeCommand('agentTabChat.view.focus');
    }),

    vscode.commands.registerCommand('agentTabChat.setApiKey', async () => {
      const which = await vscode.window.showQuickPick(['anthropic', 'openai', 'gemini'], {
        placeHolder: 'Which provider key are you setting?'
      });
      if (!which) return;
      const value = await vscode.window.showInputBox({
        prompt: `Enter ${which} API key`,
        password: true,
        ignoreFocusOut: true
      });
      if (value) {
        await secrets.set(which, value);
        vscode.window.showInformationMessage(`${which} key stored in VS Code SecretStorage.`);
        provider.refreshState();
      }
    }),

    vscode.commands.registerCommand('agentTabChat.clearApiKey', async () => {
      const which = await vscode.window.showQuickPick(['anthropic', 'openai', 'gemini'], {
        placeHolder: 'Which provider key are you clearing?'
      });
      if (!which) return;
      await secrets.delete(which);
      provider.refreshState();
    }),

    vscode.commands.registerCommand('agentTabChat.resetBudget', async () => {
      await budget.reset();
      provider.refreshState();
    }),

    vscode.commands.registerCommand('agentTabChat.newConversation', async () => {
      await conv.startNew();
      provider.refreshState();
    }),

    vscode.commands.registerCommand('agentTabChat.setupLocalModel', async () => {
      await ollamaBootstrap.runWizard({ startup: false });
    })
  );
}

export function deactivate() {}
