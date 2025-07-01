import ratingsCourseJson from "./ratings-course.json";
import { CourseRatings, Criteria } from "@/data/ratings";
import Fuse from "fuse.js";
import _ from "lodash";
import * as mathjs from "mathjs";

// @ts-ignore the json is large so typescript cannot infer the type
export const ratingsCourse: CourseRatings[] = ratingsCourseJson;

export function search(q: string, t: number, f: string): CourseRatings[] {
  const courseObjs = ratingsCourse.filter((r) =>
    Criteria.every((c) => r.ratings[c]?.confidence[t] ?? 0 !== 0),
  );

  const formula = mathjs.compile(f);

  const searchObjs = _.chain(courseObjs)
    // Calculate the score by the given formula
    .forEach((r) => {
      const scope = Object.fromEntries(
        Criteria.map((c) => [
          c,
          {
            rating: r.ratings[c].rating[t] ?? 0,
            bayesian: r.ratings[c].bayesian[t] ?? 0,
          },
        ]),
      );
      r.score = formula.evaluate(scope);
      return r;
    })

    // Sort the courses by the given criterion
    .sortBy((r) => -(r.score ?? 0))

    // Assign the rank and percentile to each course
    .forEach((r, i) => {
      r.rank = i + 1;
      r.percentile = 1 - i / courseObjs.length;
    })

    // Create searching indices
    .map((r) => ({
      subject: r.meta.subject,
      code: r.meta.code,
      course: `${r.meta.subject} ${r.meta.code}`,
      instructors: _.uniq(Object.values(r.meta.instructors).flat()),
      obj: r,
    }))

    .value();

  if (q) {
    const fuse = new Fuse(searchObjs, {
      keys: ["subject", "code", "course", "instructors"],
      shouldSort: false,
      useExtendedSearch: true,
      threshold: 0.1,
    });

    return fuse.search(q).map((it) => it.item.obj);
  }

  return searchObjs.map((it) => it.obj);
}
