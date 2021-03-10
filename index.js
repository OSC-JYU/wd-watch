const Koa			= require('koa');
const Router		= require('koa-router');
const bodyParser	= require('koa-body');
const json			= require('koa-json')

const fs 			= require('fs').promises;
const fss 			= require('fs');
var debug 			= require('debug')('debug');
const Datastore 	= require('nedb-promises')
const axios		 	= require('axios')

let db = {};
let config;

var app				= new Koa();
var router			= new Router();



(async () => {
	try {
		await loadConfig();
		db.watchlist = Datastore.create('./data/watchlist.db')
		db.watchlist.ensureIndex({ fieldName: 'label' }, function (err) {
			console.log(err)
		});
	} catch (e) {
		console.log('Could not create or load database, aborting...');
		console.log(e);
		process.exit(1);
    }
})();


//Set up body parsing middleware
app.use(bodyParser({ 
   multipart: true,
   urlencoded: true
}));


app.use(json({ pretty: true, param: 'pretty' }))
app.use(require('koa-static')('public'));


app.use(async function handleError(context, next) {

	try {
		await next();
	} catch (error) {
		context.status = 500;
		if(error.status) context.status = error.status
		if(error.message) {
			console.log('ERROR: ' + error.message);
			context.body = {'error':error.message};
		} else {
			console.log('ERROR: ' + error);
			context.body = {'error':error};
		}
		debug(error.stack);
	}
});


/* ROUTES */
router.get('/api/status', function (ctx) {
	ctx.body = 'ok'
});


router.get('/api/watchlist/sets', async function (ctx) {
	var sets = {}
	var items = await db.watchlist.find({}, {'wdset':1})
	for(item of items) {
		if(item.wdset) {
			if(item.wdset in sets) sets[item.wdset] = sets[item.wdset] + 1
			else sets[item.wdset] = 1
		}
	}
	ctx.body = sets
});


router.get('/api/watchlist', async function (ctx) {

	var q = createQuery(ctx)
	debug(q)
	var p = {};
	if(ctx.request.query.mode == 'count')
		p.count = await db.watchlist.count(q.query)
	else
		p = await db.watchlist.find(q.query, q.keys).sort(q.sort).limit(q.limit).skip(q.skip)
	ctx.body = p;
});


router.get('/api/watchlist/:qid', async function (ctx) {
	var query = {_id: ctx.params.qid}
	debug(query)
	var p = await db.watchlist.findOne(query)
	ctx.body = p;
});


// edit approval
router.put('/api/watchlist/:qid', async function (ctx) {
	var p = await db.watchlist.findOne({_id: ctx.params.qid});
	var update = {status: 'ok', modified: p.timestamp}
	var response = await db.watchlist.update({_id: ctx.params.qid}, {$set: update}, {returnUpdatedDocs:1})
	ctx.body = response;
});


router.post('/api/watchlist/query', async function (ctx) {

	if(!ctx.request.query.wdset) throw('You must set wdset!')
	let result = {ok: 0, failure: []}
	
	debug(ctx.request.query)
	var query = config.sparql_endpoint + '/sparql?query=' + encodeURI(ctx.request.query.query)
	debug('query: ' + query)
	try {
		var response = await axios(query)
		for(var item of response.data.results.bindings) {
			var qid = item.item.value.replace(/https?:\/\/www\.wikidata\.org\/entity\//,"")
			var doc = await getWikidataItem(qid)
			doc.wdset = ctx.request.query.wdset
			try {
				debug('inserting ' + qid)
				var resp = await db.watchlist.insert(doc)
				result.ok++
			} catch(e) {
				//throw({message: 'insert failed ' + e})
				console.log('insert failed ' )
				result.failure.push(qid)
			}
		}
	} catch(e) {
		throw({message: 'sparql query failed'})
	}
	ctx.body = result
});


router.post('/api/watchlist/check', async function (ctx) {
	console.log('checking...')
	var count = 0;
	var total = 0
	var query = {}
	if(ctx.query.wdset) query = {wdset: ctx.query.wdset} 
	var items = await db.watchlist.find(query)
	for(var item of items) {
		total++
		var url = config.site + "/w/api.php?action=query&format=json&prop=revisions&titles=" + item._id + "&rvprop=ids|timestamp|flags|comment|user&rvlimit=" + config.rvlimit + "&rvdir=older"
		var result = await axios(url)
		var json = result.data
		var key = Object.keys(json.query.pages)
		var timestamp = json.query.pages[key[0]].revisions[0].timestamp; // timestamp of latest edit
		if(timestamp != item.modified) {
			// we have an edit, now check how many edits there are after last check
			console.log(timestamp + ' - ' + item.modified)
			var edit_count = 0
			var edits = []
			for(var i=0; i < config.rvlimit; i++) {
				if(json.query.pages[key[0]].revisions[i]) {
					if(item.modified != json.query.pages[key[0]].revisions[i].timestamp) {
						edit_count++
						edits.push(json.query.pages[key[0]].revisions[i].comment + "::" + json.query.pages[key[0]].revisions[i].user)
					}
				}
			}
			var update = {
				status: 'edited', 
				timestamp: timestamp, 
				edits: edits,
				edit_count: edit_count
			}
			var response = await db.watchlist.update({_id: item._id}, {$set: update}, {returnUpdatedDocs:1})
			count++;
		} else {
			console.log('no change ' + item.label)
		}

	}
	console.log(count)
	ctx.body = {"total": total,"edited": count}
});


// add item to watch set
router.post('/api/watchlist/:qid', async function (ctx) {

	if(!ctx.query.wdset) throw('wdset must be set')
	var qid = ctx.params.qid
	let resp
		
	try {
		var doc = await getWikidataItem(qid)
		doc.wdset = ctx.query.wdset
		resp = await db.watchlist.insert(doc)
	} catch(e) {
		throw({message: 'insert failed ' + e})
	}
	ctx.body = resp
});


router.delete('/api/watchlist/:qid', async function (ctx) {
	var p = await db.watchlist.remove({_id: ctx.params.qid});
	ctx.body = p;
});


router.get('/api/wikidata/:qid', async function (ctx) {
	var result = await axios(config.site + '/wiki/Special:EntityData/' + ctx.params.qid + '.json')
	ctx.body = result.data
});



/* ROUTES ENDS */


app.use(router.routes());

var server = app.listen(8200, function () {
	var host = server.address().address
	var port = server.address().port
	console.log('WD-Watch running on http://%s:%s', host, port)
})


function createQuery(ctx) {
	var q = {query: {}, keys: {}, sort: {}, limit: 1000, skip: 0}
	var regex = new RegExp(["^", ctx.query.value].join(""), "i");
	var excludes = ['sort', 'limit', 'skip', 'keys', 'mode']

	for(var p in ctx.request.query) {
		if(!excludes.includes(p)) {
			// by degault we use regex
			var regex = new RegExp(["^", ctx.request.query[p]].join(""), "i");
			q.query[p] = {$regex: regex}
		}
	}

	if(ctx.request.query.keys) {
		var splitted = ctx.request.query.keys.split(',');
		for(var key of splitted) {
			q.keys[key.trim()] = 1;
		}
	}

	if(ctx.request.query.sort) q.sort[ctx.request.query.sort] = 1;
	if(ctx.request.query.limit) q.limit = parseInt(ctx.request.query.limit);
	if(ctx.request.query.skip) q.skip = parseInt(ctx.request.query.skip);
	return q;
}


async function getWikidataItem(qid) {
	try {
		var result = await axios(config.site + '/wiki/Special:EntityData/' + qid + '.json')
		var doc = {
			_id: qid, 
			label: '', 
			modified: result.data.entities[qid].modified
		}
		
		if(result.data.entities[qid].labels.en)
			doc.label = result.data.entities[qid].labels.en.value

		if(result.data.entities[qid].labels[config.preferred_label]) // preferred label if available
			doc.label = result.data.entities[qid].labels.fi.value
			
		if(!doc.label) doc.label = 'no label'
		return doc
	} catch(e) {
		throw('Could not get item ' + qid + e)
	}
}


async function loadConfig() {
	console.log('Lataan config -tiedostoa')
	const file = await fs.readFile('./config.json', 'utf8');
	config = JSON.parse(file);
}
