# WD-watch

Wikidata monitoring tool for tracking edits on watched items and generating HTML reports.

Repository: https://github.com/OSC-JYU/wd-watch

## User-Agent

Wikidata requires a user-agent with contact info. Set it in `config.json`:

```json
"user_agent": "WD-Watch/1.0 (https://github.com/OSC-JYU/wd-watch; CONTACT_EMAIL_HERE)"
```

## Running (NodeJS)

```bash
git clone https://github.com/OSC-JYU/wd-watch.git
cd wd-watch
npm install
npm start
```

Default server port is `8200`.

## Running (Docker)

```bash
make build
make start
```

Reports are exported to the `public/reports` directory.

## Converting Legacy Data

If you still have an old database (`data/watchlist.db`), convert it to the current schema:

```bash
npm run convert:v1-to-v2 -- --dry-run
npm run convert:v1-to-v2
```

Options:

- `--source <file>` defaults to `data/watchlist.db`
- `--target <file>` defaults to `data/watchlist_v2.db`
- `--runs <file>` defaults to `data/runs_v2.db`
- `--dry-run` prints what would be converted without writing
- `--force` overwrites existing rows with the same QID

## Usage

Status:

```bash
curl http://localhost:8200/api/status
```

Add one item:

```bash
curl -XPOST 'http://localhost:8200/api/watchlist/Q42?wdset=Dougs'
```

SPARQL import:

```bash
curl -G -XPOST 'http://localhost:8200/api/watchlist/query' \
  --header "Accept: application/json" \
  --data-urlencode wdset="Klimt" \
  --data-urlencode query="
SELECT ?item ?itemLabel
WHERE
{
  ?item wdt:P31 wd:Q3305213 .
  ?item wdt:P170 wd:Q34661 .
  SERVICE wikibase:label { bd:serviceParam wikibase:language \"fi,en\". }
}
limit 10
"
```

Create report:

```bash
curl -XPOST 'http://localhost:8200/api/watchlist/report?wdset=Klimt'
```

Report files are written to `public/reports/` and listed at:

```bash
curl 'http://localhost:8200/reports'
```

## Email Reports

Set `MAILER` and `MAILER_PORT`, then:

```bash
curl -XPOST 'http://localhost:8200/api/watchlist/report?wdset=Klimt&mail=somebody@somewhere.com'
```

## API Summary

- `GET /api/status`
- `GET /api/watchlist/sets`
- `GET /api/watchlist?wdset=<set>`
- `GET /api/watchlist/{qid}`
- `POST /api/watchlist/{qid}?wdset=<set>`
- `POST /api/watchlist/query?wdset=<set>&query=<sparql>`
- `DELETE /api/watchlist/{qid}`
- `DELETE /api/watchlist/sets?wdset=<set>`
- `POST /api/watchlist/report?wdset=<set>[&mail=<email>]`
- `GET /reports`
