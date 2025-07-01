import fs from "fs/promises";
import fetch from "node-fetch";

async function fetchText(url) {
  const resp = await fetch(url);
  if (!resp.ok)
    throw new Error(
      `Failed to fetch ${url}: ${resp.status} ${resp.statusText}`,
    );
  return await resp.text();
}

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok)
    throw new Error(
      `Failed to fetch ${url}: ${resp.status} ${resp.statusText}`,
    );
  return await resp.json();
}

async function updateInstructorData() {
  await fs.writeFile(
    "data/ratings-instructor.json",
    await fetchText(
      "https://raw.githubusercontent.com/ust-archive/ust-rankings-data/data/ratings-instructor.json",
    ),
  );
}

async function updateCourseData() {
  await fs.writeFile(
    "data/ratings-course.json",
    await fetchText(
      "https://raw.githubusercontent.com/ust-archive/ust-rankings-data/data/ratings-course.json",
    ),
  );
}

async function updateCQ() {
  const terms = await fetchJSON(
    "https://raw.githubusercontent.com/ust-archive/ust-cq/main/terms.json",
  );

  const cq = await Promise.all(
    terms.map(async (term) => ({
      ...term,
      cq: await fetchJSON(
        `https://raw.githubusercontent.com/ust-archive/ust-cq/main/${term.term}.json`,
      ),
    })),
  );

  await fs.writeFile("data/data-cq-terms.json", JSON.stringify(terms, null, 2));
  await fs.writeFile("data/data-cq.json", JSON.stringify(cq, null, 2));
}

async function updateCourseCatalog() {
  const catalog = await fetchText(
    "https://raw.githubusercontent.com/ust-archive/ust-course-catalog/main/course-catalog.json",
  );

  await fs.writeFile("data/data-course-catalog.json", catalog);
}

await Promise.all([
  updateInstructorData(),
  updateCourseData(),
  updateCQ(),
  updateCourseCatalog(),
]);
