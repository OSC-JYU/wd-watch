const Koa			= require('koa');
const Router		= require('koa-router');
const bodyParser	= require('koa-body');
const json			= require('koa-json')

const fs 			= require('fs').promises;
const fss 			= require('fs');
var debug 			= require('debug')('debug');
const Datastore 	= require('nedb-promises')
const fetch		 	= require('node-fetch')

let db = {};

var app				= new Koa();
var router			= new Router();
let config;

(async () => {
	try {
		await loadConfig();
		db.watchlist = Datastore.create('./data/watchlist.db')
		db.watchlist.ensureIndex({ fieldName: 'label' }, function (err) {
		  // If there was an error, err is not null
		  console.log(err)
		});
	} catch (e) {
		console.log('Could not load config.json or database, aborting...');
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
//app.use(cors());
app.use(require('koa-static')('public'));


// check that user has rights to use app
app.use(async function handleError(context, next) {
	context.request.headers.mail = 'ari.hayrinen@jyu.fi'; // for testing
	if(config.users.includes(context.request.headers.mail)) {
		await next();
	} else {
		console.log('access denied for user: ' + context.request.headers.mail);
		context.status = 403
		context.body = {'error': 'Sinulla ei ole oikeuksia Weskarin käyttöön.'};
	}
});



app.use(async function handleError(context, next) {

	try {
		await next();
	} catch (error) {
		context.status = 500;
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


router.get('/api/config', function (ctx) {
	ctx.body = {
		users: config.users
	};
});


router.post('/api/config/reload', async function (ctx) {
	await loadConfig();
	//console.log(config);
	ctx.body = {'status': 'Config loaded'};
})

router.get('/api/auth', function (ctx) {
	ctx.body = {
		shibboleth: {user:'ari.hayrinen@jyu.fi'}
	};
});


router.get('/api/status', function (ctx) {
	ctx.body = {
		shibboleth: {user:'ari.hayrinen@jyu.fi'}
	};
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
	var p = await db[ctx.params.collection].findOne(query)
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
	var doc = JSON.parse(ctx.request.body)
	debug('hit')
	debug(doc)
	var resp = await db.watchlist.insert(doc)
	ctx.body = resp;
});


router.get('/api/wikidata/:qid', async function (ctx) {
	var result = await fetch('https://test.wikidata.org/wiki/Special:EntityData/' + ctx.params.qid + '.json')
	var json = await result.json()
	ctx.body = json
});

router.post('/api/watchlist/check', async function (ctx) {
	var count = 0;
	var items = await db.watchlist.find({})
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
			console.log('ei muutettu: ' + item.label)
		}

	}
	ctx.body = {edited: count}
});




async function loadConfig() {
	console.log('Lataan config -tiedostoa')
	const file = await fs.readFile('./config.json', 'utf8');
	config = JSON.parse(file);
}

app.use(router.routes());
//app.listen(8103);

var server = app.listen(8101, function () {
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

