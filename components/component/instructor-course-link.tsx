import { type CourseObject } from "@/data";

export function InstructorCourseLink({
  course,
  thisSem,
}: {
  course: CourseObject;
  thisSem: boolean;
}) {
  const linkUstSpace = `https://ust.space/review/${course.subject}${course.course}`;
  const linkClassScheduleQuota = `https://w5.ab.ust.hk/wcq/cgi-bin/2330/subject/${course.subject}#${course.subject}${course.course}`;

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
        {course.course}
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
