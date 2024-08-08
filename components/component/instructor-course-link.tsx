import { type InstructorCourseObject } from "@/data";

export function InstructorCourseLink({
  course,
  thisSem,
}: {
  course: InstructorCourseObject;
  thisSem: boolean;
}) {
  const linkUstSpace = `https://ust.space/review/${course.subject}${course.number}`;
  const linkClassScheduleQuota = `https://w5.ab.ust.hk/wcq/cgi-bin/2410/subject/${course.subject}#${course.subject}${course.number}`;

  return (
    <span
      className="text-nowrap"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <a
        className="underline hover:text-blue-500"
        href={linkUstSpace}
        target="_blank"
      >
        {course.subject}
        {course.number}
      </a>
      &nbsp;
      {thisSem && (
        <a
          className="underline hover:text-blue-500"
          href={linkClassScheduleQuota}
          target="_blank"
        >
          (A)
        </a>
      )}
    </span>
  );
}
