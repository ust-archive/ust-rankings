export interface RawCourse {
  subject: string
  code: string
  name: string
}

export interface RawReview {
  hash: string
  semester: string
  instructors: RawInstructor[]
  rating_content: number
  rating_teaching: number
  rating_grading: number
  rating_workload: number
  upvote_count: number
  vote_count: number
}

export interface RawInstructor {
  name: string
  rating: number
}
