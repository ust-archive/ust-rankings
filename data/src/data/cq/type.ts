/** Terms represents a list of academic terms. */
export type RawTerms = RawTerm[]

/** Term represents an academic term. */
export interface RawTerm {
  /**
   * The subject of the term.
   *
   * Example: "2340"
   */
  term: string
  /**
   * The name of the term.
   *
   * Example: "2023-24 Summer"
   */
  termName: string
}

/** CQ represents a list of courses with their class information. */
export type RawCQ = Course[]

/** Course represents a course with its class information. */
export interface Course {
  /**
   * The academic career of the course.
   *
   * - "UGRD": Undergraduate
   * - "TPG": Taught Postgraduate
   * - "RPG": Research Postgraduate
   * - "EXEC": Executive Education
   *
   * Example: "UGRD"
   */
  career: 'UGRD' | 'TPG' | 'RPG' | 'EXEC'
  /**
   * The subject of the course.
   *
   * Example: "COMP" as in "COMP2711"
   */
  subject: string
  /**
   * The catalog number of the course.
   *
   * Example: "2711" as in "COMP2711"
   */
  number: string
  /**
   * The course subject of the course.
   *
   * Example: "COMP2711"
   */
  code: string
  /**
   * The name of the course.
   *
   * Example: "Discrete Mathematical Tools for Computer Science"
   */
  name: string
  /**
   * The long description of the course.
   *
   * Example:> Basic concepts in discrete mathematics needed for the study of
   * computer> Science: enumeration techniques, basic number theory, logic and
   * proofs,> Recursion and recurrences, probability theory and graph theory.
   * The> Approach of this course is specifically computer science application
   * > oriented.
   */
  description: string

  /**
   * The previous course subject of the course. If the course has no previous subject,
   * this field is an empty string.
   *
   * Example:
   *
   * - ""
   * - "COMP390A"
   */
  previousCodes: string
  /**
   * The prerequisites of the course, described in natural language. If the
   * course has no prerequisites, this field is an empty string.
   *
   * Example:
   *
   * - "Level 3 or above in HKDSE Mathematics Extended Module M1/M2"
   * - ""
   */
  prerequisites: string
  /**
   * The corequisites of the course, described in natural language. If the
   * course has no corequisites, this field is an empty string.
   *
   * Example:
   *
   * - "(For students without prerequisites) MATH 1012 OR MATH 1013 OR MATH 1014
   *   OR MATH 1020 OR MATH 1023 OR MATH 1024"
   * - ""
   */
  corequisites: string
  /**
   * The exclusions of the course, described in natural language. If the course
   * has no exclusions, this field is an empty string.
   *
   * Example:
   *
   * - "COMP 2711H, MATH 2343"
   * - ""
   */
  exclusions: string

  /**
   * The number of credits of the course.
   *
   * Example: 4
   */
  credits: number

  /** The attributes of the course. */
  attributes: CourseAttribute[]
  /** The classes of the course. */
  classes: Class[]
}

/**
 * ClassQuotaAttribute represents an "attribute" of a course.
 *
 * An attribute is a key-value pair that describes a course. For example, if the
 * course is a common core course, there will be an attribute indicating this.
 */
export interface CourseAttribute {
  /**
   * The attribute of the course.
   *
   * Example: "4Y"
   */
  attribute: string
  /**
   * The value of the attribute.
   *
   * Example: "15"
   */
  value: string
  /**
   * The description of the attribute.
   *
   * Example: "Students admitted before 2022"
   */
  attributeDescription: string
  /**
   * The description of the value.
   *
   * Example: "Common Core (QR) for 36-credit program"
   */
  valueDescription: string
}

/** Class represents a class (aka. section, e.g., L1, T2, LA3) of a course. */
export interface Class {
  /**
   * The section of the class.
   *
   * Example: "L1"
   */
  section: string
  /**
   * The number of the class.
   *
   * Example: 1091
   */
  number: string

  /**
   * The remarks of the class, described in natural language.
   *
   * This may contain information such as the special add / drop period of the
   * class in Summer or Winter term. (Because the add / drop periods of
   * different classes may be different in Summer and Winter term.)
   *
   * Example: "> Add/Drop Deadline: 18-Jul-2024"
   */
  remarks: string

  /**
   * The total number of quota of the class.
   *
   * Example: 60
   */
  quota: number
  /**
   * The current number of students enrollment of the class.
   *
   * Example: 60
   */
  enroll: number
  /**
   * The current number of students waitlist of the class.
   *
   * Example: 11
   */
  waitlist: number

  /**
   * Whether enrolling the class requires consent from the instructor.
   *
   * Example: false
   */
  consent: boolean

  /** The reserved capacity entries of the class. */
  reservedQuota: ClassReservedQuota[]
  /** The schedule entries of the class. */
  schedule: ClassSchedule[]
}

/**
 * ClassReservedQuota represents a reserved quota entry of a class.
 *
 * Some classes may have reserved quota for students of certain subjects. For
 * example, some mandatory courses for a subject may have reserved quota for
 * students of that subject.
 */
export interface ClassReservedQuota {
  /** The name of the reserved quota. */
  name: string
  /** The total number of reserved quota of the class. */
  quota: number
  /** The current number of reserved students enrollment of the class. */
  enroll: number
}

/**
 * ClassSchedule represents a schedule entry of a class.
 *
 * An entry consists of 3 parts, the date range, the time range, and the
 * weekdays.
 *
 * The date range indicates the start and the end date that this entry is
 * applicable. This is for the case where the class is separated into multiple
 * parts (often in Summer and Winter term). For example, the class may be held
 * on Monday, Wednesday, and Friday in the first month, and Tuesday and Thursday
 * in the second month.
 *
 * The time range indicates the start and the end time of the class. However,
 * there may be some cases where the class is held in different time ranges on
 * different weekdays. In this case, there will be two or more entries with
 * overlapping date ranges.
 *
 * The weekdays indicate the weekdays that the class is held. The weekdays are
 * repeated over the date range.
 */
export interface ClassSchedule {
  /**
   * The instructors of the class for this schedule.
   *
   * Example: [ "TAI, Chiew Lan" ]
   */
  instructors: string[]
  /**
   * The name of the venue of the class for this schedule.
   *
   * Example: "Rm 2405, Lift 17-18 (92)"
   */
  venue: string
  /**
   * The date that the class starts. In the format of "YYYY-MM-DD".
   *
   * Example: "2024-07-15"
   */
  fromDate: string
  /**
   * The date that the class ends. In the format of "YYYY-MM-DD".
   *
   * Example: "2024-08-09"
   */
  toDate: string
  /**
   * The weekdays of the class for this schedule.
   *
   * A set of weekdays, each represented by a number from 0 to 6, where 0 is
   * Sunday and 6 is Saturday.
   */
  weekdays: number[]
  /**
   * The time that the class starts.
   *
   * If somehow the class has no time range, for example, if the course is a
   * self-taught course, this field is undefined.
   *
   * Example: "11:00"
   */
  fromTime?: string
  /**
   * The time that the class ends.
   *
   * If somehow the class has no time range, for example, if the course is a
   * self-taught course, this field is undefined.
   *
   * Example: "12:20"
   */
  toTime?: string
}
