export function courseTitleTransitionName(prefix: string, number: string) {
  return `course-title-${prefix.toLowerCase()}-${number.toLowerCase()}`;
}

export function instructorTitleTransitionName(uuid: string) {
  return `instructor-title-${uuid.toLowerCase()}`;
}
