const Datastore 	= require('nedb-promises')
const fs 			= require('fs')

before((done) => {
	(async (done) => {
		try {
			//fs.unlinkSync()
			db.watchlist = Datastore.create('./data/watchlist.db')
			
		} catch(e) {
			console.log('Could not create collection') 
		}


	})().then(() => {
		done();
	})
});
