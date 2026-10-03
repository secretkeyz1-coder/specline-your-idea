/**
 * The split form sends one row per part: `part_title` and `part_objective`
 * repeated in order, and each criterion as `part_ac_<row>`. Rows are zipped by
 * their ORIGINAL index first and only then are rows without a title dropped —
 * filtering the titles first shifted every later row's objective and criterion
 * onto the wrong part whenever an earlier title was left blank.
 */
export type SplitPart = { title: string; objective: string; acceptance_criteria: string[] };

export function splitPartsFromForm(form: FormData): SplitPart[] {
  const titles = form.getAll("part_title").map(String);
  const objectives = form.getAll("part_objective").map(String);
  return titles
    .map((raw, i) => {
      const title = raw.trim();
      return {
        title,
        objective: (objectives[i] ?? "").trim() || title,
        acceptance_criteria: [String(form.get(`part_ac_${i}`) ?? "").trim() || `"${title}" is complete and verified.`],
      };
    })
    .filter((part) => part.title.length > 0);
}
