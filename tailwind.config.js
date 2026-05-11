/** @type {import('tailwindcss').Config} */
export default {
  content: ['./webview-src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // Map Tailwind palette to VSCode CSS variables so the UI follows the user's theme.
        bg: 'var(--vscode-editor-background)',
        fg: 'var(--vscode-foreground)',
        'fg-muted': 'var(--vscode-descriptionForeground)',
        border: 'var(--vscode-panel-border)',
        accent: 'var(--vscode-textLink-foreground)',
        'accent-hover': 'var(--vscode-textLink-activeForeground)',
        card: 'var(--vscode-editorWidget-background)',
        'btn-bg': 'var(--vscode-button-background)',
        'btn-fg': 'var(--vscode-button-foreground)',
        'btn-bg-hover': 'var(--vscode-button-hoverBackground)',
        'btn-secondary-bg': 'var(--vscode-button-secondaryBackground)',
        'btn-secondary-fg': 'var(--vscode-button-secondaryForeground)',
        success: 'var(--vscode-charts-green)',
        warning: 'var(--vscode-charts-yellow)',
        danger: 'var(--vscode-errorForeground)',
      },
      fontFamily: {
        sans: 'var(--vscode-font-family)',
        mono: 'var(--vscode-editor-font-family)',
      },
      fontSize: {
        sm: 'var(--vscode-font-size)',
      },
    },
  },
  plugins: [],
};
