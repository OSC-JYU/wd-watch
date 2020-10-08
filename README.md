 # WD-watch 
 
 Wikidata item change watch
 
WD-watch käyttää nedb-tietokantaa, eli se ei tarvitse erillistä tietokantayhteyttä.
UI on jquery-pohjainen.
 
## lokaali kehittäminen
    git clone https://github.com/OSC-JYU/wd-watch.git
    cd weskari
    npm install
    DEBUG=debug nodemon index.js
    
mene selaimella http://localhost:8101

# TODO
- use Mongo database
- allow use of sets
- document API calls

