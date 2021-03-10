# WD-watch 
 
Extremely simple Wikidata item change detection tool. The idea is to give possibility to for example museums to see how their collection items in wikidata are edited.
 WD-watch uses NeDB as a database. 

## How it works?

By creating sets of wikidata IDs, one can check if those items are edited after latest check or not. WD-watch stores timestamp of latest edit for item and then - when check is run - gets edits from wikidata API and compares timestamps. 

WD-watch is an API, although there is an UI for demonstration purposes. 
WD-watch is not meant for large datasets.

 
## running
    git clone https://github.com/OSC-JYU/wd-watch.git
    cd wd-watch
    npm install
    node index.js
    
Aim your browser to demo UI in http://localhost:8200

    DEBUG=debug nodemon index.js


	
###	API

- add individual item

    POST /api/watchlist/[QID]?wdset=[SETNAME]
    
        curl -XPOST 'http://localhost:8200/api/watchlist/Q42?wdset=Dougs'

- add items from SPARQL

    POST /api/watchlist/query?wdset=[SETNAME]&query=[QUERY]

        curl -XPOST "http://localhost:8200/api/watchlist/query?wdset=klimt&query=SELECT%20%2A%0AWHERE%0A%7B%0A%20%20%3Fitem%20wdt%3AP31%20wd%3AQ3305213%20.%0A%20%20%3Fitem%20wdt%3AP170%20wd%3AQ34661%20.%0A%0A%7D%0Alimit%2010"

- get all items in set

    GET /api/watchlist/?wdset=[SETNAME]
    
        curl  'http://localhost:8200/api/watchlist/?wdset=Dougs'

- check edits

    POST /api/watchlist/check?wdset=[SETNAME]
    
        curl -XPOST 'http://localhost:8200/api/watchlist/check?wdset=Dougs'

- delete item from set

    DELETE /api/watchlist/[QID]?wdset=[SETNAME] 
    
        curl  XDELETE 'http://localhost:8200/api/watchlist/Q42'
