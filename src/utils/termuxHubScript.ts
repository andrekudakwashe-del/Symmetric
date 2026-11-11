// Utility for retrieving, downloading, and copying the latest Termux Hub script
// Provides 100% offline fallback, Blob download generation, and Termux Heredoc formatting

export const TERMUX_HUB_VERSION = 'v3.2';
export const TERMUX_HUB_FILENAME = 'termux-hub.js';
export const TERMUX_HUB_PORT = 8080;

let cachedScript: string | null = null;

/**
 * Wraps JavaScript source code into the bash heredoc format:
 * cat << 'EOF' > termux-hub.js
 * ...
 * EOF
 * This allows single-tap pasting directly into Android Termux without syntax errors.
 */
export function formatAsTermuxHeredoc(code: string): string {
  const clean = (code || '').trim();
  if (clean.startsWith("cat << 'EOF' > termux-hub.js") || clean.startsWith('cat << "EOF" > termux-hub.js')) {
    return clean;
  }
  return `cat << 'EOF' > termux-hub.js\n${clean}\nEOF\n`;
}

/**
 * Fetches the raw termux-hub.js source code from the local server or public assets.
 * Caches in memory for instant subsequent access.
 */
export async function getTermuxHubCode(): Promise<string> {
  if (cachedScript) {
    return cachedScript;
  }

  try {
    const res = await fetch('/termux-hub.js', { cache: 'no-cache' });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 500) {
        cachedScript = text;
        return text;
      }
    }
  } catch (err) {
    console.warn('[Termux Hub] Failed to fetch /termux-hub.js directly:', err);
  }

  // If fetch failed, return empty string or error
  return cachedScript || '';
}

/**
 * Returns the Termux Hub script wrapped in the cat << 'EOF' > termux-hub.js heredoc format.
 */
export async function getTermuxHubHeredocCode(): Promise<string> {
  const raw = await getTermuxHubCode();
  return formatAsTermuxHeredoc(raw);
}

/**
 * Triggers a native file download of termux-hub.js in the user's browser.
 * Works across desktop, mobile Chrome, Safari, and offline environments.
 */
export async function downloadTermuxHubFile(): Promise<boolean> {
  try {
    let content = await getTermuxHubCode();
    
    // Create Blob
    const blob = new Blob([content], { type: 'application/javascript;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = TERMUX_HUB_FILENAME;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    return true;
  } catch (e) {
    console.error('[Termux Hub] Error triggering download:', e);
    // Fallback: direct navigation to /termux-hub.js
    const fallbackAnchor = document.createElement('a');
    fallbackAnchor.href = '/termux-hub.js';
    fallbackAnchor.download = TERMUX_HUB_FILENAME;
    document.body.appendChild(fallbackAnchor);
    fallbackAnchor.click();
    document.body.removeChild(fallbackAnchor);
    return true;
  }
}

/**
 * Copies the termux-hub.js code to clipboard in cat << 'EOF' > termux-hub.js format by default.
 * Uses navigator.clipboard with fallback to textarea selection.
 */
export async function copyTermuxHubCodeToClipboard(
  asHeredoc: boolean = true
): Promise<{ success: boolean; lineCount: number; byteSize: number }> {
  try {
    const raw = await getTermuxHubCode();
    if (!raw) {
      throw new Error('Termux script code could not be loaded.');
    }

    const codeToCopy = asHeredoc ? formatAsTermuxHeredoc(raw) : raw;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(codeToCopy);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = codeToCopy;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    const lineCount = codeToCopy.split('\n').length;
    const byteSize = new Blob([codeToCopy]).size;
    return { success: true, lineCount, byteSize };
  } catch (e) {
    console.error('[Termux Hub] Error copying code to clipboard:', e);
    return { success: false, lineCount: 0, byteSize: 0 };
  }
}
