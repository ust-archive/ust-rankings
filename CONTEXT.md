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

**Pre-enrollment**:
Enrollment in a Class assigned by the Academic Registry or a School or Program Office before normal Class enrollment.

**Queue Activation**:
The moment a Class's waitlist first becomes non-empty during normal Class enrollment. Earlier Pre-enrollment is baseline occupancy, not Queue Activation.

**Reserved Quota**:
Places within a Class's capacity set aside for an eligible student population.

**Historical Queue Evidence**:
A confidence-qualified estimate of how often comparable Classes had sufficient aggregate waitlist reduction for a given queue position by the add/drop deadline. It does not estimate an individual student's enrollment likelihood.
_Avoid_: Enrollment Probability, Enrollment Likelihood

**Waitlist Plan**:
One Course Offering together with the Classes and queue positions a student requires. A Waitlist Plan has favorable joint Historical Queue Evidence only when every selected Class has sufficient aggregate waitlist reduction. Alternative section combinations are separate Waitlist Plans.

**Instructor**:
A person who teaches a Class, distinct from any name or identifier used to refer to them.
_Avoid_: Professor, Teacher

**Instructor UUID**:
An immutable opaque identifier assigned to every Instructor. It remains the Instructor's internal identity even when an ITSC later becomes available.

**ITSC**:
The HKUST account identifier used, when available, to distinguish an Instructor. An Instructor has at most one current ITSC.

**Canonical Instructor Name**:
The preferred public display spelling of an Instructor's name. Schedule and UST Space spellings take precedence; an SFQ spelling is used only when neither is available. Several Instructors may share one Canonical Instructor Name; the name never establishes identity.

**Instructor Alias**:
A source-observed spelling associated with an Instructor. An alias is not globally unique and does not alone establish Instructor identity. When names collide, identity requires durable evidence such as an ITSC or identity-history association to a specific Course and Term.

**Instructor Identity History**:
The append-only record of ITSC additions, merges, splits, and Instructor Association Corrections carried across Ranking Generations.

**Instructor Association Correction**:
An append-only Course or Course Offering scope connecting an Instructor Alias to an Instructor UUID. It records either an association affected by a split or an Instructor Association Calibration.

**Instructor Association Calibration**:
An operator-reviewed Instructor Association Correction. A Course calibration applies to every Term; a Course Offering calibration applies only to its Term. It corrects source spelling or association evidence without merging the Instructors who otherwise use that alias.
_Avoid_: Instructor Merge when only an association is corrected

**TBA**:
A special value indicating that no Instructor is specified for a Class. It does not identify an Instructor.

## Rankings

**Ranking Generation**:
One complete, immutable snapshot of ranking evidence together with every Instructor's identity in that snapshot.

**Ranking Population**:
The eligible Courses or Instructors compared by a ranking for one Term and scoring configuration.

**Rank**:
An entity's competition rank among Courses offered or Instructors teaching in the selected Term, before structured filters or text search. An entity not active in that Term has no Rank. A Course offered or Instructor teaching that Term has a Rank even with no samples.

**Rank of All Time**:
An entity's competition rank, using the selected Term's scoring model, among every known Course or Instructor with a score by that Term, including entities not active in that Term. It does not compare peak scores or mix scores from different Terms.

**Ranking Preset**:
A named starting configuration of non-negative criterion weights. The selected preset or custom weights form one Ranking Preference shared by Course and Instructor rankings and Details.

## Accounts

**User**:
An application account created from a verified institutional External Identity. A User owns Reviews, Thumbs Votes, and Emoji Reactions.

**External Identity**:
A verified OIDC issuer-and-subject pair bound to one User. Names and email addresses supplied by the identity provider are mutable profile data, not identity.

**Public Display Name**:
A normalized, user-selected name of at most 16 user-perceived characters. It may appear on an Attributed Review Revision but is not presented as a verified legal name.

## Community Contributions

**Review**:
A user-authored evaluation with at least one Review Basis and optional Review Context. A User may have at most one active Review for each exact set of Review Bases; Review Context does not distinguish Reviews for this limit.

**Review Basis**:
A Course or Instructor evaluated by a Review. A Review has at most one Course Basis and at most one Instructor Basis, and may have both as co-equal Bases.
_Avoid_: Review Subject, Ranking Item, Target

**Review Context**:
An optional Term and Section that make a Review more specific. A Term qualifies one or both Review Bases. A Section requires a Course Basis and Term; together they identify a Class.

**Review Revision**:
An immutable version of a Review created whenever its author publishes an edit. A Review points to one current Review Revision while retaining its earlier Revisions internally.

**Review Order**:
The User-selected ordering of a multi-Review list: Top, Popular, or Recent. Top is the default.

**Identity-Hidden Review Revision**:
A Review Revision that displays no author publicly while retaining its internal User link for authorized moderation, security, and legal purposes.
_Avoid_: Anonymous Review

**Attributed Review Revision**:
A Review Revision that publicly displays the author's Public Display Name captured when that Revision was published.
_Avoid_: Non-anonymous Review

**Withdrawn Review**:
A Review that is no longer publicly displayed. Its Review Revisions remain internal while justified by the retention policy.
_Avoid_: Deleted Review

**Moderation Case**:
The minimal record of a content report, resulting operator action, or authorized internal identity lookup. It is not a general User-activity history.

**Stored File**:
The exact uploaded bytes owned by one User. A Stored File may be reused by Attachments in several Review Revisions without duplicating the bytes.

**Attachment**:
A Review Revision's immutable reference to a Stored File, with its public filename and description. An image may appear inline in Review content only through an Attachment on that Review Revision.

**Image Attachment**:
An Attachment whose Stored File is an accepted raster-image format. It may be presented inline, as a file link, or both.

**Document Attachment**:
An Attachment whose Stored File is an accepted document format. It is opened separately or downloaded, never embedded in Review content.

**Attachment Tombstone**:
The historical Attachment record retained when its Stored File is no longer available.

**Thumbs Vote**:
An authenticated User's current positive or negative evaluation of a Course, Instructor, or Review. The absence of a Thumbs Vote is neutral. A User may Thumbs Vote on their own Review. Thumbs Votes are separate from Emoji Reactions and do not affect first-release rankings. Individual voters are not public.

**Emoji Reaction**:
An authenticated User's selected expression on a Course, Instructor, or Review. A User may select several allowed reaction codes on one entity, including their own Review, but each code at most once. Individual reactors are not public.
