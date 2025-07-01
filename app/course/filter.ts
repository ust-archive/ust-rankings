import { course } from "@/data/course-catalog";
import { CourseRatings } from "@/data/ratings";

export type Filter = {
  // Utility Filters
  offeredCurrently?: boolean;

  // Common Core Course Filters
  ccArts?: boolean;
  ccHumanities?: boolean;
  ccScience?: boolean;
  ccTechnology?: boolean;
  ccSocialAnalysis?: boolean;
};

export function compileFilter(
  filter: Filter,
  term: number,
): (cr: CourseRatings) => boolean {
  return (cr: CourseRatings) => {
    if (Object.values(filter).every((it) => !it)) {
      return true; // No filter applied, show all courses
    }

    const isOfferedCurrently =
      !filter.offeredCurrently ||
      (cr.meta.instructors[term] && cr.meta.instructors[term].length > 0);

    const c = course(cr.meta.subject, cr.meta.code);
    const ccFilterEnabled =
      filter.ccArts ||
      filter.ccHumanities ||
      filter.ccScience ||
      filter.ccTechnology ||
      filter.ccSocialAnalysis;
    const isCCC =
      !ccFilterEnabled ||
      (c &&
        c.courseAttributes.some((attr) => {
          if (attr.courseAttribute === "CC22") {
            return (
              (filter.ccArts && attr.courseAttributeValue === "24") ||
              (filter.ccHumanities && attr.courseAttributeValue === "25") ||
              (filter.ccScience && attr.courseAttributeValue === "26") ||
              (filter.ccTechnology && attr.courseAttributeValue === "27") ||
              (filter.ccSocialAnalysis && attr.courseAttributeValue === "28")
            );
          } else {
            return false;
          }
        }));

    return !!(isOfferedCurrently && isCCC);
  };
}
