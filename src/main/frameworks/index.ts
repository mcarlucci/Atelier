import type { FrameworkId } from "@shared/types";
import { angularKit } from "./angular";
import { reactKit } from "./react";
import type { FrameworkKit } from "./types";
import { vueKit } from "./vue";

const kits: Record<FrameworkId, FrameworkKit> = { react: reactKit, vue: vueKit, angular: angularKit };

export function kitFor(id: FrameworkId): FrameworkKit {
  return kits[id];
}
