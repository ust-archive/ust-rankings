import { type InstructorCourseObject } from "@/data/instructor";
import { stopPropagation } from "@/lib/events";

export function InstructorCourseLink({
  course,
}: {
  course: InstructorCourseObject;
}) {
  const linkUstSpace = `https://ust.space/review/${course.subject}${course.number}`;

  return (
    <span className="text-nowrap" onClick={stopPropagation}>
      <a
        className="underline hover:text-blue-500"
        href={linkUstSpace}
        target="_blank"
      >
        {course.subject}
        {course.number}
      </a>
    </span>
  );
}
