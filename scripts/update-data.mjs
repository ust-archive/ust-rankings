import fetch from 'node-fetch'
import fs from 'fs/promises'

async function fetchText(url) {
	const resp = await fetch(url)
	return await resp.text()
}

async function updateData() {
	const DATA_URL = "https://raw.githubusercontent.com/ust-archive/ust-rankings-data/main/ust-rankings.json"
	await fs.writeFile('data/data.json', await fetchText(DATA_URL))
}

await Promise.all([
	updateData(),
])
