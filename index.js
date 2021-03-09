const Koa			= require('koa');
const Router		= require('koa-router');
const bodyParser	= require('koa-body');
const json			= require('koa-json')

const fs 			= require('fs').promises;
const fss 			= require('fs');
var debug 			= require('debug')('debug');
const Datastore 	= require('nedb-promises')
const fetch		 	= require('node-fetch')
const axios		 	= require('axios')

let db = {};

var app				= new Koa();
var router			= new Router();

(async () => {
	try {
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


router.put('/api/watchlist/:qid', async function (ctx) {
	var p = await db.watchlist.findOne({_id: ctx.params.qid});
	console.log(p)
	var update = {status: 'ok', modified: p.timestamp}
	var response = await db.watchlist.update({_id: ctx.params.qid}, {$set: update}, {returnUpdatedDocs:1})
	ctx.body = response;
});


router.post('/api/watchlist', async function (ctx) {
	//var doc = JSON.parse(ctx.request.body)
	var doc = ctx.request.body
	if(typeof ctx.request.body == 'string') doc = JSON.parse(ctx.request.body)
	debug('hit')
	debug(doc)
	try {
		var resp = await db.watchlist.insert(doc)
	} catch(e) {
		throw({message: 'insert failed ' + e})
	}
	ctx.body = resp
});

router.post('/api/watchlist/query', async function (ctx) {

	debug(ctx.request.query)
	var query = 'https://query.wikidata.org/sparql?query=' + encodeURI(ctx.request.query.query)
	debug(query)
	try {
		var result = await axios(query)
		for(var item of result.data.results.bindings) {
			var doc = {_id: '',label:''}
			doc._id = item.item.value.replace("http://www.wikidata.org/entity/","")
			doc.label = item.itemLabel.value
			doc.wdset = ctx.request.query.wdset
			try {
				debug('inserting ' + doc._id)
				var resp = await db.watchlist.insert(doc)
			} catch(e) {
				//throw({message: 'insert failed ' + e})
				console.log('insert failed')
			}
		}
	} catch(e) {
		throw({message: 'sparql query failed'})
	}
	ctx.body = 'ok'
});


router.delete('/api/watchlist/:qid', async function (ctx) {
	var p = await db.watchlist.remove({_id: ctx.params.qid});
	ctx.body = p;
});


router.get('/api/wikidata/:qid', async function (ctx) {
	var result = await fetch('https://test.wikidata.org/wiki/Special:EntityData/' + ctx.params.qid + '.json')
	var json = await result.json()
	ctx.body = json
});

router.post('/api/watchlist/check', async function (ctx) {
	console.log('checking...')
	var count = 0;
	var query = {}
	if(ctx.query.wdset) query = {wdset: ctx.query.wdset} 
	var items = await db.watchlist.find(query)
	for(var item of items) {
		var url = "https://test.wikidata.org/w/api.php?action=query&format=json&prop=revisions&titles=" + item._id + "&rvprop=ids|timestamp|flags|comment|user&rvlimit=1&rvdir=older"
		var result = await fetch(url)
		var json = await result.json()
		var key = Object.keys(json.query.pages)
		var timestamp = json.query.pages[key[0]].revisions[0].timestamp;
		if(timestamp != item.modified) {
			console.log(timestamp + ' - ' + item.modified)
			var update = {status: 'edited', timestamp: timestamp, comment: json.query.pages[key[0]].revisions[0].comment, user: json.query.pages[key[0]].revisions[0].user}
			var response = await db.watchlist.update({_id: item._id}, {$set: update}, {returnUpdatedDocs:1})
			count++;
		} else {
			console.log('no change ' + item.label)
		}

	}
	console.log(count)
	ctx.body = {edited: count}
});




app.use(router.routes());

var server = app.listen(8200, function () {
   var host = server.address().address
   var port = server.address().port
   
   console.log('WD-Watch käynnissä osoitteessa http://%s:%s', host, port)
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


