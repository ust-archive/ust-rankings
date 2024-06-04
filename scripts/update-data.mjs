import fetch from 'node-fetch'
import fs from 'fs/promises'
import he from 'he'
import ical from 'node-ical';

async function fetchText(url) {
	const resp = await fetch(url)
	return await resp.text()
}

async function updateData() {
	const DATA_URL = "https://raw.githubusercontent.com/ust-archive/ust-rankings-data/main/ust-rankings.json"
	await fs.writeFile('data/data.json', await fetchText(DATA_URL))
}

async function updateCalendar() {
	const CURRENT_TERM_URL = "https://github.com/FlandiaYingman/quota-data-at-ust/raw/main/data/current-term.txt"
	const currentTerm = await fetchText(CURRENT_TERM_URL)

	const SCHEDULE_URL = `https://github.com/FlandiaYingman/quota-data-at-ust/raw/main/data/${currentTerm} Slim.json`
	const CALENDAR_URL = "https://caldates.ust.hk/cgi-bin/eng/ical.php"

	await fs.writeFile('data/schedule/term.json', JSON.stringify(currentTerm))
	await fs.writeFile('data/schedule/schedule.json', await fetchText(SCHEDULE_URL))
	await fs.writeFile('data/schedule/calendar.json', JSON.stringify(ical.sync.parseICS(he.decode(await fetchText(CALENDAR_URL))), null, 2))
}

await Promise.all([
	updateData(),
	updateCalendar(),
])
