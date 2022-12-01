const Datastore 	= require('nedb-promises')
const fs 			= require('fs')
let db = {}

before((done) => {
	(async (done) => {
		try {
			//fs.unlinkSync()
			db.watchlist = Datastore.create('./data/watchlist.db')
			var items = await db.watchlist.find({})
			if(items.length) throw(`Tests can be run only with empty database!\n run 'rm data/watchlist.db' \n restart app`)

		} catch(e) {
			console.log(e)
			process.exit(0)
		}


	})().then(() => {
		done();
	})
});
