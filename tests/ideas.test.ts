import { expect, test } from "vitest";
import { rankIdeas } from "../src/shared/ideas";

const ideas = [
  { id: "a", needs: ["table", "card"] },
  { id: "b", needs: ["switch"] },
  { id: "c", needs: ["stepper", "progress"] },
];

test("puts ideas the design system can build first, keeping order for ties", () => {
  expect(rankIdeas(ideas, ["Switch", "Button"]).map((i) => i.id)).toEqual(["b", "a", "c"]);
  expect(rankIdeas(ideas, ["DataTable", "Card", "Progress"]).map((i) => i.id)).toEqual(["a", "c", "b"]);
  expect(rankIdeas(ideas, []).map((i) => i.id)).toEqual(["a", "b", "c"]);
});
