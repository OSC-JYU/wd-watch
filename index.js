const Hapi = require('@hapi/hapi');
const fs = require('fs').promises;
const fss = require('fs');
const debug = require('debug')('debug');
const Datastore = require('nedb-promises');
const axios = require('axios');
const Inert = require('@hapi/inert');
const Path = require('path');
const Report = require('./report.js');

const mailer = process.env.MAILER || 'smtp.jyu.fi';
const port = process.env.MAILER_PORT || 25;

let db = {};
let config;
let report;

async function startServer() {
  await loadConfig();
  config.mailer = mailer;
  config.mailer_port = port;
  
  // Configure axios with default user agent from config
  axios.defaults.headers.common['User-Agent'] = config.user_agent || 'WD-Watch/1.0'
  
  console.log(config);

  report = new Report(config);

  db.watchlist = Datastore.create('./data/watchlist.db');
  db.watchlist.ensureIndex({ fieldName: 'label' }, (err) => {
    console.log(err);
  });

  const server = Hapi.server({
    port: 8200,
    host: '0.0.0.0',
    routes: {
      files: {
        relativeTo: Path.join(__dirname, 'public')
      },
      cors: true
    }
  });

  await server.register(Inert); // for static files

  server.route([
    {
      method: 'GET',
      path: '/api/status',
      handler: () => 'ok'
    },
    {
      method: 'GET',
      path: '/reports',
      handler: async () => {
        const files = await readdirSortTime('public/reports');
        return files;
      }
    },
    {
      method: 'GET',
      path: '/api/watchlist/sets',
      handler: async () => {
        const sets = {};
        const items = await db.watchlist.find({}, { wdset: 1 });
        for (const item of items) {
          if (item.wdset) {
            sets[item.wdset] = (sets[item.wdset] || 0) + 1;
          }
        }
        return sets;
      }
    },
    {
      method: 'DELETE',
      path: '/api/watchlist/sets',
      handler: async (request) => {
        const query = { wdset: request.query.wdset };
        await db.watchlist.remove(query, { multi: true });
        return 'done';
      }
    },
    {
      method: 'GET',
      path: '/api/watchlist',
      handler: async (request) => {
        const q = createQuery(request);
        debug(q);
        if (request.query.mode === 'count') {
          const count = await db.watchlist.count(q.query);
          return { count };
        } else {
          const results = await db.watchlist.find(q.query, q.keys)
            .sort(q.sort)
            .limit(q.limit)
            .skip(q.skip);
          return results;
        }
      }
    },
    {
      method: 'GET',
      path: '/api/watchlist/{qid}',
      handler: async (request) => {
        const query = { _id: request.params.qid };
        debug(query);
        const item = await db.watchlist.findOne(query);
        return item;
      }
    },
    {
      method: 'PUT',
      path: '/api/watchlist/{qid}',
      handler: async (request) => {
        const p = await db.watchlist.findOne({ _id: request.params.qid });
        const update = { status: 'ok', latest_edit: p.timestamp };
        const response = await db.watchlist.update({ _id: request.params.qid }, { $set: update }, { returnUpdatedDocs: true });
        return response;
      }
    },
    {
      method: 'POST',
      path: '/api/watchlist/report',
      handler: async (request) => {
        if (!request.query.wdset) throw new Error('You must set wdset!');
        const filename = await report.create(request.query.wdset, db, request.query.mode, request.query.mail);
        return filename;
      }
    },
    {
      method: 'POST',
      path: '/api/watchlist/query',
      handler: async (request) => {
        if (!request.query.wdset) throw new Error('You must set wdset!');

        let result = { ok: 0, failure: [] };
        debug(request.query);

        const queryUrl = config.sparql_endpoint + '/sparql?query=' + encodeURI(request.query.query);
        debug('query: ' + queryUrl);

        try {
          const response = await axios.get(queryUrl);
          for (const item of response.data.results.bindings) {
            const qid = item.item.value.replace(/https?:\/\/www\.wikidata\.org\/entity\//, '');
            const doc = await getWikidataItem(qid, item);
            doc.wdset = request.query.wdset;
            try {
              await db.watchlist.insert(doc);
              result.ok++;
            } catch (e) {
              result.failure.push(qid);
            }
          }
        } catch (e) {
          throw new Error('SPARQL query failed');
        }
        return result;
      }
    },
    {
      method: 'POST',
      path: '/api/watchlist/{qid}',
      handler: async (request) => {
        if (!request.query.wdset) throw new Error('wdset must be set');
        const qid = request.params.qid;
        let resp;

        try {
          const doc = await getWikidataItem(qid);
          doc.wdset = request.query.wdset;
          resp = await db.watchlist.insert(doc);
        } catch (e) {
          throw new Error('Insert failed ' + e);
        }
        return resp;
      }
    },
    {
      method: 'DELETE',
      path: '/api/watchlist/{qid}',
      handler: async (request) => {
        const p = await db.watchlist.remove({ _id: request.params.qid });
        return p;
      }
    },
    {
      method: 'GET',
      path: '/api/wikidata/{qid}',
      handler: async (request) => {
        const result = await axios.get(`${config.site}/wiki/Special:EntityData/${request.params.qid}.json`);
        return result.data;
      }
    },
    {
      method: 'GET',
      path: '/{param*}',
      handler: {
        directory: {
          path: '.',
          listing: true
        }
      }
    }
  ]);

  await server.start();
  console.log(`WD-Watch running on ${server.info.uri}`);
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Helper functions
async function readdirSortTime(dir) {
  const files = await fs.readdir(dir);
  const fileStats = await Promise.all(files.map(async file => {
    const stat = await fs.stat(Path.join(dir, file));
    return { file, mtime: stat.mtime };
  }));
  return fileStats.sort((a, b) => b.mtime - a.mtime).map(f => f.file);
}

function createQuery(request) {
  // Assuming you have a logic here for query construction
  return {
    query: {},
    keys: {},
    sort: {},
    limit: 100,
    skip: 0
  };
}

async function getWikidataItem(qid, item) {
  // Replace this with your real logic
  return {
    _id: qid,
    item: item || {}
  };
}

async function loadConfig() {
	console.log('Lataan config -tiedostoa')
	const file = await fs.readFile('./config.json', 'utf8');
	config = JSON.parse(file);

}
