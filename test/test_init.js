const Datastore 	= require('nedb-promises')
const fs 			= require('fs')

before((done) => {
	(async (done) => {
		try {
			//fs.unlinkSync()
			db.watchlist = Datastore.create('./data/watchlist.db')
			
		} catch(e) {
			console.log('pyynnot kokoelmaa ei voitu dropata') // continue even if collection did not exist
		}


	})().then(() => {
		done();
	})
});
