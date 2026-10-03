import { create } from 'zustand';

interface UiState {
  /** Sidebar drawer state on small screens. */
  sidebarOpen: boolean;
  openSidebar(): void;
  closeSidebar(): void;
  toggleSidebar(): void;

  /** The idea the creator typed on Home and carried into Create. */
  draftIdea: string;
  setDraftIdea(idea: string): void;

  /**
   * Audience Mirror feedback carried back into Trend Remix when the creator
   * chooses "Revise". Stored here rather than in a URL query so the feedback
   * survives a route change without being encoded into the address bar.
   */
  mirrorFeedback: string[];
  setMirrorFeedback(feedback: string[]): void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  draftIdea: '',
  setDraftIdea: (draftIdea) => set({ draftIdea }),

  mirrorFeedback: [],
  setMirrorFeedback: (mirrorFeedback) => set({ mirrorFeedback }),
}));
