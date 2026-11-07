import { expect, test } from "vitest";
import { milestones } from "../src/shared/milestones";

test("an existing app counts as a first build", () => {
  expect(milestones({ designSystems: 1, apps: 1 }).find((m) => m.id === "first-build")?.done).toBe(true);
});

test("counts what the user has done", () => {
  const done = (m: ReturnType<typeof milestones>) => m.filter((x) => x.done).map((x) => x.id);
  expect(done(milestones({ designSystems: 0, apps: 0 }))).toEqual([]);
  expect(done(milestones({ designSystems: 2, apps: 0, progress: { firstBuild: 1 } }))).toEqual(["design-system", "first-build"]);
  expect(done(milestones({ designSystems: 1, apps: 1, progress: { firstBuild: 1, compliancePass: 2, restored: 3 } }))).toHaveLength(4);
});
