#!/usr/bin/env node

const path = require('path');
const Datastore = require('nedb-promises');

function parseArgs(argv) {
  const options = {
    source: path.join('data', 'watchlist.db'),
    target: path.join('data', 'watchlist_v2.db'),
    runs: path.join('data', 'runs_v2.db'),
    dryRun: false,
    force: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--source' || arg === '--target' || arg === '--runs') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error(`Missing value for ${arg}`);
      }
      const key = arg.replace('--', '');
      options[key] = next;
      i += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log('Convert WD-watch v1 watchlist database into the current format.');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/convert_v1_to_v2.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --source <file>   Source v1 NeDB file (default: data/watchlist.db)');
  console.log('  --target <file>   Target watchlist file (default: data/watchlist_v2.db)');
  console.log('  --runs <file>     Target runs file (default: data/runs_v2.db)');
  console.log('  --dry-run         Show what would be converted, write nothing');
  console.log('  --force           Overwrite existing target rows for same _id');
  console.log('  --help            Show this help');
}

function normalizeQid(raw) {
  if (raw === undefined || raw === null) {
    return null;
  }

  let value = String(raw).trim();

  if (value.startsWith('http://') || value.startsWith('https://')) {
    const match = value.match(/\/entity\/(Q\d+)$/i) || value.match(/\/(Q\d+)$/i);
    value = match ? match[1] : value;
  }

  value = value.toUpperCase();
  if (!/^Q\d+$/.test(value)) {
    return null;
  }

  return value;
}

function getLabelFromLegacy(doc) {
  if (doc.label && String(doc.label).trim()) {
    return String(doc.label).trim();
  }

  if (doc.item && doc.item.itemLabel && doc.item.itemLabel.value) {
    return String(doc.item.itemLabel.value).trim();
  }

  return '';
}

function getDescriptionFromLegacy(doc) {
  if (doc.description && String(doc.description).trim()) {
    return String(doc.description).trim();
  }

  if (doc.item && doc.item.itemDescription && doc.item.itemDescription.value) {
    return String(doc.item.itemDescription.value).trim();
  }

  return '';
}

function getSetName(doc) {
  if (doc.wdset && String(doc.wdset).trim()) {
    return String(doc.wdset).trim();
  }

  if (doc.set && String(doc.set).trim()) {
    return String(doc.set).trim();
  }

  return null;
}

function toV2Doc(doc, defaultSite) {
  const qid = normalizeQid(doc._id || doc.qid || (doc.item && doc.item.value));
  const wdset = getSetName(doc);

  if (!qid || !wdset) {
    return null;
  }

  const label = getLabelFromLegacy(doc) || qid;
  const description = getDescriptionFromLegacy(doc);
  const wdUrl = doc.wd_url && String(doc.wd_url).trim()
    ? String(doc.wd_url).trim()
    : `${defaultSite}/wiki/${qid}`;

  return {
    _id: qid,
    wdset,
    label,
    description,
    wd_url: wdUrl
  };
}

function latestTimestamp(current, candidate) {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return candidate > current ? candidate : current;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const sourceDb = Datastore.create(args.source);
  const targetDb = Datastore.create(args.target);
  const runsDb = Datastore.create(args.runs);

  const sourceRows = await sourceDb.find({});

  let converted = 0;
  let skipped = 0;
  let updated = 0;
  const setStats = {};
  const docsToWrite = [];

  for (const row of sourceRows) {
    const doc = toV2Doc(row, 'https://www.wikidata.org');
    if (!doc) {
      skipped += 1;
      continue;
    }

    docsToWrite.push({ original: row, converted: doc });

    if (!setStats[doc.wdset]) {
      setStats[doc.wdset] = { item_count: 0, last_run: null };
    }

    setStats[doc.wdset].item_count += 1;

    const timeCandidate = row.latest_edit || row.timestamp || null;
    setStats[doc.wdset].last_run = latestTimestamp(setStats[doc.wdset].last_run, timeCandidate);
  }

  if (!args.dryRun) {
    await targetDb.ensureIndex({ fieldName: '_id', unique: true });
    await targetDb.ensureIndex({ fieldName: 'wdset' });
    await runsDb.ensureIndex({ fieldName: 'wdset', unique: true });
  }

  for (const row of docsToWrite) {
    const doc = row.converted;

    if (args.dryRun) {
      converted += 1;
      continue;
    }

    try {
      await targetDb.insert(doc);
      converted += 1;
    } catch (err) {
      const isDuplicate = String(err).includes('unique') || String(err).includes('already exists');
      if (!isDuplicate) {
        throw err;
      }

      if (!args.force) {
        skipped += 1;
        continue;
      }

      await targetDb.update({ _id: doc._id }, { $set: doc }, { upsert: true });
      updated += 1;
    }
  }

  if (!args.dryRun) {
    const setNames = Object.keys(setStats);
    for (const wdset of setNames) {
      const runDoc = {
        wdset,
        last_run: setStats[wdset].last_run || new Date(0).toISOString(),
        item_count: setStats[wdset].item_count,
        edit_count: 0
      };
      await runsDb.update({ wdset }, { $set: runDoc }, { upsert: true });
    }
  }

  console.log(`Source rows: ${sourceRows.length}`);
  console.log(`Convertible rows: ${docsToWrite.length}`);
  console.log(`Converted inserts: ${converted}`);
  console.log(`Updated existing: ${updated}`);
  console.log(`Skipped rows: ${skipped}`);
  console.log(`Sets found: ${Object.keys(setStats).length}`);

  if (args.dryRun) {
    console.log('Dry-run mode enabled: no files were modified.');
  }
}

main().catch((err) => {
  console.error('Conversion failed:', err.message);
  process.exit(1);
});
