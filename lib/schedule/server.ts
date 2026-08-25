export type ScheduleTerm = {
  termNumber: number;
  termCode: string;
  termName: string;
};

export type ScheduleInstructor = {
  sourceName: string;
  uuid?: string;
};

export type ScheduleMeeting = {
  weekday: "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";
  dateFrom?: string;
  dateTo?: string;
  timeFrom?: string;
  timeTo?: string;
  room: string;
  roomCode: string;
  instructors: ScheduleInstructor[];
};

export type ScheduleClass = {
  termCode: string;
  coursePrefix: string;
  courseNumber: string;
  courseCode: string;
  courseTitle: string;
  courseDescription?: string;
  section: string;
  classNumber: number;
  role: "E" | "N";
  classType: "LEC" | "TUT" | "LAB" | "IND";
  association?: number;
  remarks: string;
  capacity: number;
  enrollment: number;
  waitlist: number;
  consent: boolean;
  open: boolean;
  meetings: ScheduleMeeting[];
  reservations: Array<{ name: string; quota: number; enrollment: number }>;
};

export type CourseOffering = {
  termNumber: number;
  termCode: string;
  termName: string;
  courseId: string;
  coursePrefix: string;
  courseNumber: string;
  courseCode: string;
  career: "UGRD" | "TPG" | "RPG" | "EXEC";
  title: string;
  description: string;
  credits: number;
  previousCourseCodes: string;
  prerequisite: string;
  corequisite: string;
  exclusion: string;
  attributes: Array<{ label: string; value: string; description: string }>;
  classes: ScheduleClass[];
};

export type SchedulePage = {
  generation: string;
  terms: ScheduleTerm[];
  term: ScheduleTerm;
  search?: string;
  results: CourseOffering[];
  total: number;
};

export type ScheduleEntity =
  | { type: "course"; coursePrefix: string; courseNumber: string }
  | { type: "instructor"; uuids: string[] }
  | {
      type: "course-offering";
      termCode: string;
      coursePrefix: string;
      courseNumber: string;
    }
  | {
      type: "class";
      termCode: string;
      coursePrefix: string;
      courseNumber: string;
      section: string;
    };

export type ScheduleDetails =
  | ({ type: "course"; offerings: CourseOffering[] } & Pick<
      CourseOffering,
      "coursePrefix" | "courseNumber" | "courseCode"
    >)
  | { type: "instructor"; instructorUuids: string[]; classes: ScheduleClass[] }
  | ({ type: "course-offering" } & CourseOffering)
  | ({ type: "class" } & ScheduleClass);
