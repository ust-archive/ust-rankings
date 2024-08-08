import fs from "fs/promises";
import fetch from "node-fetch";

async function fetchText(url) {
  const resp = await fetch(url);
  return await resp.text();
}

async function updateInstructorData() {
  await fs.writeFile(
    "data/data-instructor.json",
    await fetchText(
      "https://raw.githubusercontent.com/ust-archive/ust-rankings-data/main/data-instructor.json",
    ),
  );
}

await Promise.all([updateInstructorData()]);
