/**
 * historyNavigationService
 * Centralized manager for Mobile / Android phone hardware Back button,
 * gesture navigation, and browser History API integration.
 */

export interface NavigationHistoryEntry {
  tab: string;
  modal?: string | null;
  timestamp: number;
}

type BackPressHandler = () => boolean; // returns true if handled/consumed

class HistoryNavigationService {
  private tabStack: string[] = [];
  private modalHandlers: Map<string, BackPressHandler> = new Map();
  private lastBackPressTime: number = 0;
  private isInitialized: boolean = false;
  private onNavigateTabCallback: ((tab: string) => void) | null = null;
  private onToastMessageCallback: ((msg: string) => void) | null = null;

  public init(
    initialTab: string,
    onNavigateTab: (tab: string) => void,
    onToastMessage?: (msg: string) => void
  ) {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.onNavigateTabCallback = onNavigateTab;
    this.onToastMessageCallback = onToastMessage || null;

    this.tabStack = [initialTab];

    // Replace current history entry with initial state
    try {
      if (typeof window !== 'undefined') {
        window.history.replaceState({ tab: initialTab, depth: 0 }, '', `#${initialTab}`);
        window.addEventListener('popstate', this.handlePopState);
      }
    } catch (e) {
      console.warn('History API not fully available:', e);
    }
  }

  public registerModalHandler(modalId: string, handler: BackPressHandler) {
    this.modalHandlers.set(modalId, handler);
    // Push a dummy history state so hardware back triggers popstate without leaving page
    try {
      window.history.pushState({ modalId, type: 'modal' }, '');
    } catch (e) {}
  }

  public unregisterModalHandler(modalId: string) {
    this.modalHandlers.delete(modalId);
  }

  public pushTab(newTab: string) {
    const currentTab = this.tabStack[this.tabStack.length - 1];
    if (currentTab === newTab) return;

    this.tabStack.push(newTab);
    try {
      window.history.pushState(
        { tab: newTab, depth: this.tabStack.length },
        '',
        `#${newTab}`
      );
    } catch (e) {}
  }

  public handlePopState = (event: PopStateEvent) => {
    // 1. First, check if any registered modal/drawer is open and wants to consume the back event
    if (this.modalHandlers.size > 0) {
      // Find the last registered handler (LIFO)
      const entries = Array.from(this.modalHandlers.entries());
      const [lastId, lastHandler] = entries[entries.length - 1];
      const consumed = lastHandler();
      if (consumed) {
        this.modalHandlers.delete(lastId);
        return;
      }
    }

    // 2. Dispatch a global DOM event so active component sub-modals can intercept
    const backEvent = new CustomEvent('saimetric_hardware_back', {
      bubbles: true,
      cancelable: true,
    });
    const notCancelled = window.dispatchEvent(backEvent);
    if (!notCancelled) {
      // A component cancelled the back action (e.g. closed its own modal)
      return;
    }

    // 3. Otherwise, navigate back in the tab stack
    if (this.tabStack.length > 1) {
      this.tabStack.pop(); // Remove current
      const previousTab = this.tabStack[this.tabStack.length - 1];
      if (this.onNavigateTabCallback && previousTab) {
        this.onNavigateTabCallback(previousTab);
      }
      return;
    }

    // 4. If we are on the root tab (length <= 1)
    const now = Date.now();
    if (now - this.lastBackPressTime > 2000) {
      this.lastBackPressTime = now;
      // Re-push current state to avoid closing app on first press
      const currentTab = this.tabStack[0] || 'pos';
      try {
        window.history.pushState({ tab: currentTab, depth: 1 }, '', `#${currentTab}`);
      } catch (e) {}

      if (this.onToastMessageCallback) {
        this.onToastMessageCallback('Press back again to exit application');
      }
    } else {
      // User tapped back twice within 2 seconds: let default exit happen
      // Do nothing to let browser navigate away
    }
  };

  public destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.handlePopState);
    }
    this.modalHandlers.clear();
    this.isInitialized = false;
  }
}

export const historyNavigationService = new HistoryNavigationService();
