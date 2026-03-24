const Hapi = require('@hapi/hapi');
const Inert = require('@hapi/inert');
const fs = require('fs').promises;
const Path = require('path');
const Datastore = require('nedb-promises');
const axios = require('axios');

const Report = require('./report.js');

const mailer = process.env.MAILER || 'smtp.jyu.fi';
const mailerPort = Number(process.env.MAILER_PORT || 25);
const appPort = Number(process.env.PORT || 8200);

let db = {};
let config;
let report;

async function startServer() {
  await loadConfig();

  config.mailer = mailer;
  config.mailer_port = mailerPort;
  axios.defaults.headers.common['User-Agent'] = config.user_agent || 'WD-Watch/2.0';

  report = new Report(config);

  db.watchlist = Datastore.create('./data/watchlist_v2.db');
  db.runs = Datastore.create('./data/runs_v2.db');

  db.watchlist.ensureIndex({ fieldName: 'wdset' }, () => {});
  db.runs.ensureIndex({ fieldName: 'wdset', unique: true }, () => {});

  const server = Hapi.server({
    port: appPort,
    host: '0.0.0.0',
    routes: {
      files: {
        relativeTo: Path.join(__dirname, 'public')
      },
      cors: true
    }
  });

  await server.register(Inert);

  server.route([
    {
      method: 'GET',
      path: '/api/status',
      handler: () => ({ ok: true })
    },
    {
      method: 'GET',
      path: '/reports',
      handler: async () => {
        const files = await readdirSortTime(Path.join('public', 'reports'));
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
        if (!request.query.wdset) {
          throw new Error('wdset must be set');
        }
        await db.watchlist.remove({ wdset: request.query.wdset }, { multi: true });
        await db.runs.remove({ wdset: request.query.wdset }, { multi: false });
        return { deleted: true };
      }
    },
    {
      method: 'GET',
      path: '/api/watchlist',
      handler: async (request) => {
        const q = createQuery(request.query);
        if (request.query.mode === 'count') {
          const count = await db.watchlist.count(q.query);
          return { count };
        }
        return db.watchlist.find(q.query, q.keys).sort(q.sort).limit(q.limit).skip(q.skip);
      }
    },
    {
      method: 'GET',
      path: '/api/watchlist/{qid}',
      handler: async (request) => {
        return db.watchlist.findOne({ _id: request.params.qid });
      }
    },
    {
      method: 'POST',
      path: '/api/watchlist/report',
      handler: async (request) => {
        if (!request.query.wdset) {
          throw new Error('You must set wdset');
        }

        const options = {};
        if (request.query.days !== undefined) {
          const days = Number(request.query.days);
          if (!Number.isInteger(days) || days < 1 || days > 3650) {
            throw new Error('days must be an integer between 1 and 3650');
          }
          options.editPeriodDays = days;
        }

        const template = request.query.template ? String(request.query.template).trim().toLowerCase() : 'email-safe';
        if (template !== 'email-safe' && template !== 'web') {
          throw new Error('template must be either email-safe or web');
        }
        options.reportTemplate = template;

        const result = await report.create(request.query.wdset, db, request.query.mail, options);
        return result;
      }
    },
    {
      method: 'POST',
      path: '/api/watchlist/{qid}',
      handler: async (request) => {
        if (!request.query.wdset) {
          throw new Error('wdset must be set');
        }

        const qid = normalizeQid(request.params.qid);
        const doc = await getWikidataItem(qid);
        doc.wdset = request.query.wdset;

        try {
          const inserted = await db.watchlist.insert(doc);
          return inserted;
        } catch (err) {
          if (String(err).includes('unique') || String(err).includes('already exists')) {
            const existing = await db.watchlist.findOne({ _id: qid });
            if (existing && existing.wdset !== request.query.wdset) {
              await db.watchlist.update({ _id: qid }, { $set: { wdset: request.query.wdset } }, {});
              return db.watchlist.findOne({ _id: qid });
            }
            return existing;
          }
          throw new Error('Insert failed: ' + err.message);
        }
      }
    },
    {
      method: 'POST',
      path: '/api/watchlist/query',
      handler: async (request) => {
        if (!request.query.wdset) {
          throw new Error('You must set wdset');
        }
        if (!request.query.query) {
          throw new Error('SPARQL query is missing');
        }

        const maxFailureDetails = 100;
        const result = {
          ok: 0,
          processed: 0,
          skipped_existing: 0,
          skipped_other_set: 0,
          failure_count: 0,
          failure: []
        };
        const queryUrl = `${config.sparql_endpoint}/sparql?query=${encodeURIComponent(request.query.query)}`;
        const response = await axios.get(queryUrl, {
          headers: {
            Accept: 'application/sparql-results+json'
          }
        });

        for (const binding of response.data.results.bindings) {
          if (!binding.item || !binding.item.value) {
            continue;
          }

          result.processed += 1;
          const qid = normalizeQid(binding.item.value.replace(/https?:\/\/www\.wikidata\.org\/entity\//, ''));
          try {
            const doc = await getWikidataItem(qid, binding);
            doc.wdset = request.query.wdset;
            await db.watchlist.insert(doc);
            result.ok += 1;
          } catch (err) {
            const isDuplicate = String(err).includes('unique') || String(err).includes('already exists');
            if (isDuplicate) {
              const existing = await db.watchlist.findOne({ _id: qid });
              if (existing && existing.wdset === request.query.wdset) {
                result.skipped_existing += 1;
              } else {
                result.skipped_other_set += 1;
              }
              continue;
            }

            result.failure_count += 1;
            if (result.failure.length < maxFailureDetails) {
              result.failure.push({ qid, error: err.message });
            }
          }
        }

        if (result.failure_count > result.failure.length) {
          result.failure_truncated = true;
        }

        return result;
      }
    },
    {
      method: 'DELETE',
      path: '/api/watchlist/{qid}',
      handler: async (request) => {
        const qid = normalizeQid(request.params.qid);
        const count = await db.watchlist.remove({ _id: qid }, {});
        return { deleted: count };
      }
    },
    {
      method: 'GET',
      path: '/api/wikidata/{qid}',
      handler: async (request) => {
        const qid = normalizeQid(request.params.qid);
        const result = await axios.get(`${config.site}/wiki/Special:EntityData/${qid}.json`);
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

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

function createQuery(query = {}) {
  const wdset = query.wdset ? String(query.wdset) : undefined;
  const limit = query.limit ? Math.max(1, Math.min(1000, Number(query.limit))) : 100;
  const skip = query.skip ? Math.max(0, Number(query.skip)) : 0;
  const sort = { label: 1 };

  const dbQuery = {};
  if (wdset) {
    dbQuery.wdset = wdset;
  }

  return {
    query: dbQuery,
    keys: {},
    sort,
    limit,
    skip
  };
}

async function readdirSortTime(dir) {
  await fs.mkdir(dir, { recursive: true });
  const files = await fs.readdir(dir);
  const stats = await Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(Path.join(dir, file));
      return { file, mtime: stat.mtime };
    })
  );

  return stats.sort((a, b) => b.mtime - a.mtime).map((f) => f.file);
}

function normalizeQid(value) {
  const qid = String(value || '').trim().toUpperCase();
  if (!/^Q\d+$/.test(qid)) {
    throw new Error(`Invalid QID: ${value}`);
  }
  return qid;
}

async function getWikidataItem(qid, binding) {
  const url = `${config.site}/w/api.php?action=wbgetentities&ids=${qid}&props=labels|descriptions&languages=${config.preferred_lang}|en&format=json`;
  const response = await axios.get(url);
  const entity = response.data.entities && response.data.entities[qid];

  if (!entity) {
    throw new Error(`Wikidata entity not found: ${qid}`);
  }

  const label = pickMonolingual(entity.labels, config.preferred_lang) || (binding && binding.itemLabel && binding.itemLabel.value) || qid;
  const description = pickMonolingual(entity.descriptions, config.preferred_lang) || '';

  return {
    _id: qid,
    label,
    description,
    wd_url: `${config.site}/wiki/${qid}`
  };
}

function pickMonolingual(obj = {}, preferredLang) {
  if (obj[preferredLang] && obj[preferredLang].value) {
    return obj[preferredLang].value;
  }
  if (obj.en && obj.en.value) {
    return obj.en.value;
  }
  const firstKey = Object.keys(obj)[0];
  return firstKey ? obj[firstKey].value : '';
}

async function loadConfig() {
  const file = await fs.readFile('./config.json', 'utf8');
  config = JSON.parse(file);
}
