export interface Ratings {
  [criterion: string]: {
    rating: {
      [term: string]: number;
    };
    bayesian: {
      [term: string]: number;
    };
    confidence: {
      [term: string]: number;
    };
    samples: {
      [term: string]: number;
    };
  };
}

export interface CourseRatings {
  meta: {
    /**
     * The course subject, e.g., "COMP".
     */
    subject: string;
    /**
     * The course number, e.g., "1023".
     */
    code: string;

    instructors: {
      [term: string]: string[];
    };
  };
  ratings: Ratings;

  score?: number;
  rank?: number;
  percentile?: number;
}

export interface InstructorRatings {
  meta: {
    /**
     * The instructor's name.
     */
    name: string;

    courses: {
      [term: string]: {
        subject: string;
        code: string;
      }[];
    };
  };
  ratings: Ratings;

  score?: number;
  rank?: number;
  percentile?: number;
}

export class RatingsMap<T> {
  #values: { [criterion: string]: { [term: string]: T } } = {};

  get(criterion: string, term: string): T | undefined {
    return this.#values[criterion]?.[term];
  }

  set(criterion: string, term: string, value: T): void {
    if (!this.#values[criterion]) {
      this.#values[criterion] = {};
    }
    this.#values[criterion][term] = value;
  }

  criteria(): string[] {
    return Object.keys(this.#values);
  }

  terms(): string[] {
    const termsSet = new Set<string>();
    for (const criterion in this.#values) {
      for (const term in this.#values[criterion]) {
        termsSet.add(term);
      }
    }
    return Array.from(termsSet);
  }
}

export const Criteria = [
  "content",
  "teaching",
  "grading",
  "workload",
  "course",
  "instructor",
] as const;

export type Criteria = (typeof Criteria)[number];

export const CriteriaName = {
  content: "Content (ust.space)",
  teaching: "Teaching (ust.space)",
  grading: "Grading (ust.space)",
  workload: "Workload (ust.space)",
  course: "Course (SFQ)",
  instructor: "Instructor (SFQ)",
};

export function termCode2Num(term: string): number {
  return parseInt(term.slice(0, 2)) * 4 + (parseInt(term.slice(2, 3)) - 1);
}
