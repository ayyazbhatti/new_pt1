/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket gateway URL (full `ws://…/ws?group=…`). Overrides dev default `ws://127.0.0.1:3003/ws?group=default`. */
  readonly VITE_WS_URL?: string
  /** Port for ws-gateway when `VITE_WS_URL` is unset (dev only). Default `3003`. */
  readonly VITE_WS_PORT?: string
  /** Optional override; default `/dp` (nginx + Vite proxy → data-provider HTTP). Set to `''` to disable same-origin base. */
  readonly VITE_DATA_PROVIDER_HTTP_PATH?: string
}
