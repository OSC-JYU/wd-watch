# WD-watch

Extremely simple Wikidata item change detection tool. The idea is to give possibility to for example museums to see how their collection items in wikidata are edited.
 WD-watch uses NeDB as a database.

## How it works?

By creating sets of wikidata IDs, one can check if those items are edited after latest check or not. WD-watch stores timestamp of latest edit for item and then - when check is run - gets edits from wikidata API and compares timestamps.

When request is made to the /watchlist/report endpoint, WD-watch creates an HTML-report of changes.

WD-watch is not meant for large datasets.


## Running (Docker)

    git clone https://github.com/OSC-JYU/wd-watch.git
    cd wd-watch
    make build
    make start

## Running (NodeJS)

    git clone https://github.com/OSC-JYU/wd-watch.git
    cd wd-watch
    npm install
    node index.js

## Usage

Check that API is responsing

    curl http://localhost:8200/api/status

Add Adam Douglas:

    curl -XPOST 'http://localhost:8200/api/watchlist/Q42?wdset=Dougs'

Create report:

    curl -XPOST 'http://localhost:8200/api/watchlist/report?wdset=Dougs'

This will return something like '/reports/Dougs_2022-12-1.html'
Aim your browser to http://localhost:8200/reports/Dougs_2022-12-1.html

The first report includes all edits (the limit is the "rvlimit" setting in config.js). However, the next report includes edits that has newer timestamp than previous report.

Let's add ten artworks by Gustav Klimt with SPARQL:

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

Create report for Klimt works:

    curl -XPOST 'http://localhost:8200/api/watchlist/report?wdset=Klimt'

## Installation

Do not expose WD-watch API to the world. It's meant to be used locally only. However, you can expose 'reports' -directory, so people can easily access reports.


###	API

- add individual item

    POST /api/watchlist/[QID]?wdset=[SETNAME]

        curl -XPOST 'http://localhost:8200/api/watchlist/Q42?wdset=Dougs'

- add items directly with SPARQL

    POST /api/watchlist/query?wdset=[SETNAME]&query=[QUERY]
    Query result must include "**item**", so start your query with "SELECT ?item ...".

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


- get all sets

    GET /api/watchlist/sets

        curl  'http://localhost:8200/api/watchlist/sets'



- get all items in set

    GET /api/watchlist/?wdset=[SETNAME]

        curl  'http://localhost:8200/api/watchlist/?wdset=Dougs'


- delete item from set

    DELETE /api/watchlist/[QID]?wdset=[SETNAME]

        curl  XDELETE 'http://localhost:8200/api/watchlist/Q42'


- create report

    POST /api/watchlist/report?wdset=[SETNAME]

        curl -XPOST 'http://localhost:8200/api/watchlist/report?wdset=Dougs'


- list reports page

    GET /reports

        http://localhost:8200/reports
