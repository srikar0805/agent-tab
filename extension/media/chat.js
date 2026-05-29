(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const messagesEl = $('messages');
  const emptyState = $('emptyState');
  const emptySubtitle = $('emptySubtitle');
  const ctxText = $('ctxText');
  const ctxBar = $('ctxBar');
  const dayPill = $('dayPill');
  const dayText = $('dayText');
  const monthPill = $('monthPill');
  const monthText = $('monthText');
  const modelSel = $('modelSelect');
  const input = $('input');
  const sendBtn = $('sendBtn');
  const cancelBtn = $('cancelBtn');
  const statusEl = $('status');
  const modeHint = $('modeHint');
  const newBtn = $('newBtn');
  const keyBtn = $('keyBtn');
  const sessionTitle = $('sessionTitle');

  const modelToProvider = new Map();
  let state = null;
  let estimateDebounce;

  vscode.postMessage({ type: 'init' });

  function formatWarning(message) {
    const s = String(message ?? 'Unknown error');
    if (/NOT_FOUND|not found/i.test(s) && /gemini/i.test(s)) {
      return 'Selected Gemini model is unavailable for this API key. Pick gemini-2.5-pro or gemini-2.5-flash.';
    }
    const singleLine = s.replace(/\s+/g, ' ').trim();
    return singleLine.length > 220 ? singleLine.slice(0, 220) + '…' : singleLine;
  }

  function fmtMoney(v) {
    if (!Number.isFinite(v)) return '$0';
    if (v >= 100) return '$' + v.toFixed(0);
    if (v >= 10) return '$' + v.toFixed(1);
    return '$' + v.toFixed(2);
  }

  function applyMeterClass(el, frac) {
    const f = Math.max(0, Math.min(1, frac));
    el.classList.toggle('warn', f >= 0.75 && f < 0.95);
    el.classList.toggle('crit', f >= 0.95);
  }

  function setContext(used, total) {
    const t = Math.max(total, 1);
    const frac = used / t;
    ctxBar.style.width = (Math.min(frac, 1) * 100).toFixed(1) + '%';
    applyMeterClass(ctxBar, frac);
    ctxText.textContent =
      used.toLocaleString() + ' / ' + t.toLocaleString();
  }

  function setBudgetPill(pill, textEl, spend, limit) {
    const frac = limit > 0 ? spend / limit : 0;
    applyMeterClass(pill, frac);
    textEl.textContent = fmtMoney(spend) + ' / ' + fmtMoney(limit);
  }

  function setMessagesScroll() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHref(raw) {
    try {
      const url = new URL(String(raw), window.location.href);
      return /^(https?:|mailto:)$/.test(url.protocol) ? url.href : '#';
    } catch {
      return '#';
    }
  }

  function inlineMarkdown(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      return `<a href="${escapeHtml(safeHref(url))}" target="_blank" rel="noreferrer noopener">${label}</a>`;
    });
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_, prefix, body) => `${prefix}<em>${body}</em>`);
    return out;
  }

  function renderMarkdownHtml(text) {
    const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
    const parts = [];

    for (let i = 0; i < lines.length; ) {
      const line = lines[i];

      if (line.startsWith('```')) {
        const lang = line.slice(3).trim();
        const code = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith('```')) {
          code.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        parts.push(`
          <div class="code-block">
            <div class="code-toolbar">
              <span class="code-lang">${escapeHtml(lang || 'code')}</span>
              <button type="button" class="code-copy">Copy</button>
            </div>
            <pre><code>${escapeHtml(code.join('\n'))}</code></pre>
          </div>
        `);
        continue;
      }

      if (/^#{1,3}\s+/.test(line)) {
        const level = Math.min(3, line.match(/^#+/)?.[0].length ?? 1);
        const content = line.replace(/^#{1,3}\s+/, '');
        parts.push(`<h${level}>${inlineMarkdown(content)}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i += 1;
        }
        parts.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
        continue;
      }

      if (!line.trim()) {
        i += 1;
        continue;
      }

      const para = [line];
      i += 1;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].startsWith('```') &&
        !/^#{1,3}\s+/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i])
      ) {
        para.push(lines[i]);
        i += 1;
      }
      parts.push(`<p>${inlineMarkdown(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }

    return parts.join('');
  }

  function formatTurnFooter(message) {
    if (message.role !== 'assistant') return '';
    const tokens = [
      `${(message.inputTokens ?? 0).toLocaleString()} in`,
      `${(message.outputTokens ?? 0).toLocaleString()} out`
    ].join(' / ');
    const cost = typeof message.costUSD === 'number' ? `$${message.costUSD.toFixed(4)}` : '$0.0000';
    const duration = typeof message.durationMs === 'number' ? `${(message.durationMs / 1000).toFixed(1)}s` : '';
    const model = message.model || state?.conversation?.model || 'model';
    return [model, tokens, cost, duration].filter(Boolean).join(' · ');
  }

  function wireMessageActions(card, message) {
    card.querySelectorAll('[data-action="copy"]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(message.content);
          setStatus('copied');
          setTimeout(() => {
            if (statusEl.textContent === 'copied') setStatus('');
          }, 1000);
        } catch {
          setStatus('copy failed', 'warn');
        }
      });
    });

    card.querySelectorAll('[data-action="retry"]').forEach((button) => {
      button.addEventListener('click', () => {
        vscode.postMessage({ type: 'retry' });
      });
    });

    card.querySelectorAll('.code-copy').forEach((button) => {
      button.addEventListener('click', async () => {
        const code = button.closest('.code-block')?.querySelector('code')?.textContent ?? '';
        try {
          await navigator.clipboard.writeText(code);
          setStatus('copied code');
          setTimeout(() => {
            if (statusEl.textContent === 'copied code') setStatus('');
          }, 1000);
        } catch {
          setStatus('copy failed', 'warn');
        }
      });
    });
  }

  function createMessageCard(message, index, streaming = false) {
    const card = document.createElement('article');
    card.className = `msg ${message.role}` + (streaming ? ' streaming' : '');

    const head = document.createElement('div');
    head.className = 'msg-head';
    const role = document.createElement('span');
    role.className = 'role';
    role.textContent = message.role;
    head.appendChild(role);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'msg-action';
    copyBtn.dataset.action = 'copy';
    copyBtn.title = 'Copy message';
    copyBtn.textContent = 'Copy';
    actions.appendChild(copyBtn);

    if (message.role === 'assistant' && !streaming) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'msg-action';
      retryBtn.dataset.action = 'retry';
      retryBtn.title = 'Retry last response';
      retryBtn.textContent = 'Retry';
      actions.appendChild(retryBtn);
    }

    head.appendChild(actions);
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'msg-body';
    if (streaming) {
      body.style.whiteSpace = 'pre-wrap';
      body.textContent = message.content;
      const caret = document.createElement('span');
      caret.className = 'stream-caret';
      caret.textContent = '▍';
      body.appendChild(caret);
    } else {
      body.innerHTML = renderMarkdownHtml(message.content);
    }
    card.appendChild(body);

    if (message.role === 'assistant' && !streaming) {
      const footer = document.createElement('div');
      footer.className = 'msg-footer';
      footer.textContent = formatTurnFooter(message);
      card.appendChild(footer);
    }

    wireMessageActions(card, message);
    return card;
  }

  function renderMessages() {
    const list = state.conversation.messages.filter((m) => m.role !== 'system');
    [...messagesEl.children].forEach((c) => {
      if (c.id !== 'emptyState') c.remove();
    });

    if (list.length === 0) {
      emptyState.hidden = false;
      const providerLabel = state.conversation.provider;
      const modelLabel = state.conversation.model;
      const isLocal = providerLabel === 'ollama';
      emptySubtitle.textContent = isLocal
        ? `Running ${modelLabel} locally — free, on your machine.`
        : `Using ${modelLabel} via ${providerLabel}.`;
      return;
    }

    emptyState.hidden = true;
    list.forEach((message, index) => {
      messagesEl.appendChild(createMessageCard(message, index, false));
    });
    setMessagesScroll();
  }

  function renderMeters(estimateTokens) {
    const used = estimateTokens ?? state.conversation.inputTokens + state.conversation.outputTokens;
    setContext(used, state.contextWindow);

    const b = state.budget;
    setBudgetPill(dayPill, dayText, b.daySpend, b.dayLimit);
    setBudgetPill(monthPill, monthText, b.monthSpend, b.monthLimit);
  }

  function renderModelPicker() {
    modelToProvider.clear();
    modelSel.innerHTML = '';
    for (const provider of state.providers) {
      for (const model of state.models[provider] ?? []) {
        if (modelToProvider.has(model)) continue;
        modelToProvider.set(model, provider);
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSel.appendChild(option);
      }
    }
    const selectedModel = modelToProvider.has(state.conversation.model)
      ? state.conversation.model
      : modelSel.options[0]?.value;
    if (selectedModel) modelSel.value = selectedModel;
    fitModelChip();
  }

  function fitModelChip() {
    // Size the select to fit current selection text (cap by max-width).
    const text = modelSel.options[modelSel.selectedIndex]?.textContent ?? '';
    const ch = Math.max(4, Math.min(text.length + 1, 22));
    modelSel.style.width = ch + 'ch';
  }

  function updateModeHint() {
    const isMac = navigator.userAgent.includes('Mac');
    const send = isMac ? '⌘↵' : 'Ctrl+↵';
    const provider = state?.conversation?.provider;
    const mode = provider === 'ollama' ? 'Local' : provider ? capitalize(provider) : 'Idle';
    modeHint.textContent = `${mode} · ${send} to send`;
  }

  function capitalize(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }

  function autoResizeInput() {
    input.style.height = '0px';
    const next = Math.min(input.scrollHeight, 200);
    input.style.height = next + 'px';
    input.style.overflowY = input.scrollHeight > 200 ? 'auto' : 'hidden';
  }

  function scheduleEstimate() {
    clearTimeout(estimateDebounce);
    estimateDebounce = setTimeout(() => {
      vscode.postMessage({ type: 'estimate', draft: input.value });
    }, 600);
  }

  let currentAssistantEl = null;
  let currentAssistantBody = null;

  function startStream() {
    setStreaming(true);
    setStatus('streaming…');
    emptyState.hidden = true;
    currentAssistantEl = createMessageCard({ role: 'assistant', content: '' }, 0, true);
    currentAssistantBody = currentAssistantEl.querySelector('.msg-body');
    messagesEl.appendChild(currentAssistantEl);
  }

  function appendDelta(t) {
    if (!currentAssistantBody) return;
    const caret = currentAssistantBody.querySelector('.stream-caret');
    if (caret) caret.remove();
    currentAssistantBody.appendChild(document.createTextNode(t));
    currentAssistantBody.appendChild(Object.assign(document.createElement('span'), { className: 'stream-caret', textContent: '▍' }));
    setMessagesScroll();
  }

  function endStream(usage, turnCost) {
    setStreaming(false);
    setStatus(
      '+' +
        usage.inputTokens.toLocaleString() +
        ' in · ' +
        usage.outputTokens.toLocaleString() +
        ' out · $' +
        turnCost.toFixed(4)
    );
    currentAssistantEl = null;
      currentAssistantBody = null;
  }

  function setStreaming(on) {
    // ensure only one of send/stop is visible
    if (on) {
      sendBtn.setAttribute('hidden', '');
      cancelBtn.removeAttribute('hidden');
    } else {
      cancelBtn.setAttribute('hidden', '');
      sendBtn.removeAttribute('hidden');
    }
  }

  function setStatus(text, kind) {
    statusEl.classList.remove('warn', 'error');
    if (kind === 'warn') statusEl.classList.add('warn');
    if (kind === 'error') statusEl.classList.add('error');
    statusEl.textContent = text;
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'state') {
      state = m.payload;
      renderModelPicker();
      renderMessages();
      renderMeters();
      updateModeHint();
      autoResizeInput();
    }
    if (m.type === 'estimate' && state) renderMeters(m.tokens);
    if (m.type === 'streamStart') startStream();
    if (m.type === 'streamDelta') appendDelta(m.text);
    if (m.type === 'streamEnd') endStream(m.usage, m.turnCost);
    if (m.type === 'appendUser') {
      if (state) {
        state.conversation.messages.push({ role: 'user', content: m.content });
        renderMessages();
      }
    }
    if (m.type === 'error') {
      setStatus(formatWarning(m.message), 'error');
      setStreaming(false);
    }
  });

  input.addEventListener('input', () => {
    autoResizeInput();
    scheduleEstimate();
  });

  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });

  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  newBtn.addEventListener('click', () => vscode.postMessage({ type: 'newConversation' }));
  keyBtn.addEventListener('click', () => vscode.postMessage({ type: 'setApiKey' }));
  dayPill.addEventListener('click', () => vscode.postMessage({ type: 'openSetting', key: 'agentTab.budget.dailyUSD' }));
  monthPill.addEventListener('click', () => vscode.postMessage({ type: 'openSetting', key: 'agentTab.budget.monthlyUSD' }));

  modelSel.addEventListener('change', () => {
    const provider = modelToProvider.get(modelSel.value);
    if (!provider) return;
    fitModelChip();
    vscode.postMessage({ type: 'switchModel', provider, model: modelSel.value });
  });

  // Suggestion cards
  document.querySelectorAll('.suggestion').forEach((el) => {
    el.addEventListener('click', () => {
      const prompt = el.getAttribute('data-prompt') || el.textContent.trim();
      input.value = prompt;
      autoResizeInput();
      input.focus();
    });
  });

  function send() {
    const draft = input.value.trim();
    if (!draft) return;
    input.value = '';
    autoResizeInput();
    setStatus('');
    vscode.postMessage({ type: 'send', draft });
  }

  autoResizeInput();
})();
