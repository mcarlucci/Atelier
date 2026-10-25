import type { AtelierApi } from "../shared/ipc";

declare global {
  interface Window {
    atelier: AtelierApi;
  }
}
