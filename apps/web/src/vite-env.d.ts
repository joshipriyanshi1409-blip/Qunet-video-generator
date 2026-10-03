/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the CreatorDNA API. Empty = same origin (Vite proxies it). */
  readonly VITE_API_URL?: string;
  /** Where the Vite dev server proxies `/api`, `/health` and `/ws`. */
  readonly VITE_API_PROXY_TARGET?: string;
  /**
   * Coaching socket path. Must match the API's `VOICE_COACH_WS_PATH`.
   * A relative path works because the dev server proxies `/ws`.
   */
  readonly VITE_VOICE_COACH_WS_PATH?: string;

  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
