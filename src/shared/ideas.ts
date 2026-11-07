/** Orders prompt ideas so the ones the design system can build best come first (stable for ties). */
export function rankIdeas<T extends { needs: string[] }>(ideas: readonly T[], componentNames: readonly string[]): T[] {
  const names = componentNames.map((n) => n.toLowerCase());
  const score = (idea: T) => idea.needs.filter((need) => names.some((n) => n.includes(need))).length;
  return ideas
    .map((idea, i) => ({ idea, i, s: score(idea) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.idea);
}
