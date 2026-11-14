/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** HTTPS address of the group signaling server, set in .env. */
  readonly VITE_SIGNALING_URL?: string;
}
