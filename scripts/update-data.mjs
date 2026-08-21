import { writeFile } from "node:fs/promises";

const url =
  "https://raw.githubusercontent.com/ust-archive/ust-course-catalog/main/course-catalog.json";
const response = await fetch(url);
if (!response.ok)
  throw new Error(
    `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
  );

await writeFile("data/data-course-catalog.json", await response.text());
