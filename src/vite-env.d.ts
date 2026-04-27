/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional override; default `/dp` (nginx + Vite proxy → data-provider HTTP). Set to `''` to disable same-origin base. */
  readonly VITE_DATA_PROVIDER_HTTP_PATH?: string
}
