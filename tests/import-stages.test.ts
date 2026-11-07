import { expect, test } from "vitest";
import { importStage } from "../src/shared/importStages";

test("maps log lines to stages", () => {
  expect(importStage("[compile] Compiling the Invariant contract…").title).toBe("Building the contract");
  expect(importStage("Reading 12 declaration file(s) for React components…").title).toBe("Reading components");
  expect(importStage("Downloading the Chromium browser").title).toBe("Setting up browser checks");
  expect(importStage("Installing vuetify…").title).toBe("Downloading the package");
});
