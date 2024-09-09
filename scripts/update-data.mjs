import fs from "fs/promises";
import fetch from "node-fetch";

async function fetchText(url) {
  const resp = await fetch(url);
  return await resp.text();
}

async function fetchJSON(url) {
  const resp = await fetch(url);
  return await resp.json();
}

async function updateInstructorData() {
  await fs.writeFile(
    "data/data-instructor.json",
    await fetchText(
      "https://raw.githubusercontent.com/ust-archive/ust-rankings-data/main/data-instructor.json",
    ),
  );
}

async function updateCourseData() {
  await fs.writeFile(
    "data/data-course.json",
    await fetchText(
      "https://raw.githubusercontent.com/ust-archive/ust-rankings-data/main/data-course.json",
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

await Promise.all([updateInstructorData(), updateCourseData(), updateCQ()]);
