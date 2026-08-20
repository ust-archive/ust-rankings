# UST Rankings

Domain language for HKUST courses, teaching, rankings, and schedules.

## Academic Structure

**Course**:
An HKUST catalog course identified by its Course Code, such as COMP 1023. A course that receives a new Course Code is a different Course, even when the catalog links it to a previous course.
_Avoid_: Class, Course Offering, Section

**Course Code**:
The identifier of a Course, composed of a Course Prefix and a Course Number, such as COMP 1023.

**Course Prefix**:
The alphabetic part of a Course Code, such as COMP. It may be shortened to Prefix when the course context is clear.
_Avoid_: Subject

**Course Number**:
The numeric part of a Course Code, such as 1023. It may be shortened to Number when the course context is clear.
_Avoid_: Code

**Academic Year**:
An HKUST academic year spanning two calendar years, written in canonical form such as 2025-26.

**Season**:
The part of an Academic Year in which a Term occurs: Fall, Winter, Spring, or Summer.

**Term**:
An HKUST academic teaching period within an Academic Year, identified by its Season.
_Avoid_: Semester

**Term Code**:
The coded identifier of a Term, such as 2510.

**Term Number**:
The zero-based sequential number of a Term, where 0 is 2000-01 Fall and consecutive numbers advance chronologically through Fall, Winter, Spring, and Summer. Term Numbers support arithmetic for finding earlier or later Terms.
_Avoid_: Semester Number

**Term Name**:
The canonical human-readable name of a Term, composed of its Academic Year and Season, such as 2025-26 Fall.
_Avoid_: Calendar-year forms such as 2000 Spring

**Course Offering**:
A Course offered in a particular Term.
_Avoid_: Course when the term-specific meaning matters

**Section**:
A designation within a Course Offering, such as L1, T1, or LA1.
_Avoid_: Class

**Class**:
A specific Section of a Course Offering, determined by its Course, Term, and Section.
_Avoid_: Course, Course Offering, Section

**Class Number**:
A numeric identifier assigned to a Class, unique within a Term, such as 1004. It may be shortened to Number when the class context is clear.
_Avoid_: Section

**Instructor**:
A person who teaches a Class, distinct from any name or identifier used to refer to them.
_Avoid_: Professor, Teacher

**ITSC**:
The HKUST account identifier used, when available, to distinguish an Instructor.

**TBA**:
A special value indicating that no Instructor is specified for a Class. It does not identify an Instructor.
