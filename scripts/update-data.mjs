import fetch from 'node-fetch'
import fs from 'fs/promises'

const DATA_URL = "https://raw.githubusercontent.com/Waver-Velvet/ust-rankings-data/main/ust-rankings.json"

const resp = await fetch(DATA_URL)
const content = await resp.text()

await fs.writeFile('data/data.json', content)
