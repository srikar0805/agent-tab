import * as vscode from 'vscode';

interface BudgetState {
  dayKey: string;
  monthKey: string;
  daySpend: number;
  monthSpend: number;
}

const KEY = 'agentTab.budget';

export class BudgetTracker {
  constructor(private state: vscode.Memento) {}

  private now() {
    const tz = vscode.workspace.getConfiguration('agentTab').get<string>('budget.resetTimezone', 'local');
    const d = new Date();
    if (tz === 'UTC') {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return { dayKey: `${yyyy}-${mm}-${dd}`, monthKey: `${yyyy}-${mm}` };
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return { dayKey: `${yyyy}-${mm}-${dd}`, monthKey: `${yyyy}-${mm}` };
  }

  snapshot(): BudgetState {
    const { dayKey, monthKey } = this.now();
    const s = this.state.get<BudgetState>(KEY) ?? { dayKey, monthKey, daySpend: 0, monthSpend: 0 };
    if (s.dayKey !== dayKey) {
      s.dayKey = dayKey;
      s.daySpend = 0;
    }
    if (s.monthKey !== monthKey) {
      s.monthKey = monthKey;
      s.monthSpend = 0;
    }
    return s;
  }

  async add(usd: number) {
    const s = this.snapshot();
    s.daySpend += usd;
    s.monthSpend += usd;
    await this.state.update(KEY, s);
  }

  async reset() {
    const { dayKey, monthKey } = this.now();
    await this.state.update(KEY, { dayKey, monthKey, daySpend: 0, monthSpend: 0 });
  }

  read() {
    const s = this.snapshot();
    const cfg = vscode.workspace.getConfiguration('agentTab');
    return {
      daySpend: s.daySpend,
      monthSpend: s.monthSpend,
      dayLimit: cfg.get<number>('budget.dailyUSD', 5),
      monthLimit: cfg.get<number>('budget.monthlyUSD', 50)
    };
  }
}
