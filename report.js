const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const nodemailer = require('nodemailer');

module.exports = class Report {
  constructor(config) {
    this.config = config;

    axios.defaults.headers.common['User-Agent'] = config.user_agent || 'WD-Watch/2.0';

    this.transporter = nodemailer.createTransport({
      host: config.mailer,
      port: Number(config.mailer_port || 25),
      secure: false,
      tls: { minVersion: 'TLSv1', rejectUnauthorized: false }
    });
  }

  async create(wdset, db, mail) {
    const now = new Date();
    const nowIso = now.toISOString();

    const lastRun = await db.runs.findOne({ wdset });
    const sinceTimestamp = lastRun && lastRun.last_run ? lastRun.last_run : null;

    const watchItems = await db.watchlist.find({ wdset }).sort({ label: 1 });
    if (!watchItems.length) {
      throw new Error(`No watched items found for set '${wdset}'`);
    }

    const itemsWithEdits = [];
    let totalEdits = 0;
    let truncatedItems = 0;

    for (const item of watchItems) {
      const editResult = await this.getItemEdits(item, sinceTimestamp);
      if (editResult.edits.length) {
        totalEdits += editResult.edits.length;
        if (editResult.truncated) {
          truncatedItems += 1;
        }
        itemsWithEdits.push({
          item,
          edits: editResult.edits
        });
      }
    }

    const reportData = this.buildReportData({
      wdset,
      sinceTimestamp,
      nowIso,
      watchItems,
      itemsWithEdits,
      totalEdits,
      truncatedItems
    });

    const html = this.createHtml(reportData);

    await fs.mkdir(path.join('public', 'reports'), { recursive: true });
    const filename = `${wdset}_${this.getDateFilePart(now)}.html`;
    const fullPath = path.join('public', 'reports', filename);
    await fs.writeFile(fullPath, html, 'utf8');

    await db.runs.update(
      { wdset },
      { $set: { wdset, last_run: nowIso, item_count: watchItems.length, edit_count: totalEdits } },
      { upsert: true }
    );

    if (mail) {
      await this.sendMail(mail, wdset, html);
    }

    return {
      report: `/reports/${filename}`,
      wdset,
      total_items: watchItems.length,
      changed_items: itemsWithEdits.length,
      total_edits: totalEdits,
      since: sinceTimestamp,
      generated_at: nowIso,
      truncated_items: truncatedItems
    };
  }

  async sendMail(email, wdset, html) {
    const message = {
      from: 'nobody@jyu.fi',
      to: email,
      subject: `WD-Watch V2 report: ${wdset}`,
      text: 'WD-Watch V2 report attached as HTML body',
      html
    };

    const info = await this.transporter.sendMail(message);
    return info.messageId;
  }

  async getItemEdits(item, sinceTimestamp) {
    const rvlimit = Number(this.config.rvlimit || 100);
    const url = `${this.config.site}/w/api.php?action=query&format=json&prop=revisions&titles=${item._id}&rvprop=ids|timestamp|comment|user|flags|tags&rvlimit=${rvlimit}&rvdir=older`;
    const response = await axios.get(url);

    const pages = response.data && response.data.query && response.data.query.pages ? response.data.query.pages : {};
    const firstPageKey = Object.keys(pages)[0];
    const revisions = firstPageKey && pages[firstPageKey] && pages[firstPageKey].revisions ? pages[firstPageKey].revisions : [];

    const edits = [];
    let truncated = false;

    for (const revision of revisions) {
      if (!revision.timestamp) {
        continue;
      }

      if (sinceTimestamp && revision.timestamp <= sinceTimestamp) {
        break;
      }

      edits.push({
        qid: item._id,
        item_label: item.label || item._id,
        timestamp: revision.timestamp,
        user: revision.user || 'unknown',
        comment: revision.comment || '',
        revid: revision.revid,
        parentid: revision.parentid,
        minor: revision.minor !== undefined,
        tags: revision.tags || []
      });
    }

    if (sinceTimestamp && revisions.length === rvlimit && revisions[revisions.length - 1] && revisions[revisions.length - 1].timestamp > sinceTimestamp) {
      truncated = true;
    }

    return { edits, truncated };
  }

  buildReportData({ wdset, sinceTimestamp, nowIso, watchItems, itemsWithEdits, totalEdits, truncatedItems }) {
    const editsFlat = [];
    const propertySet = new Set();

    for (const row of itemsWithEdits) {
      for (const edit of row.edits) {
        const properties = this.extractProperties(edit.comment);
        edit.properties = properties;
        for (const property of properties) {
          propertySet.add(property);
        }
        edit.action = this.getActionFromComment(edit.comment);
        editsFlat.push(edit);
      }
    }

    editsFlat.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    const editsByUser = {};
    const editsByAction = {};

    for (const edit of editsFlat) {
      editsByUser[edit.user] = (editsByUser[edit.user] || 0) + 1;
      editsByAction[edit.action] = (editsByAction[edit.action] || 0) + 1;
    }

    return {
      wdset,
      sinceTimestamp,
      nowIso,
      watchCount: watchItems.length,
      changedItemCount: itemsWithEdits.length,
      totalEdits,
      truncatedItems,
      editsFlat,
      itemsWithEdits,
      uniquePropertyCount: propertySet.size,
      editsByUser: this.toSortedEntries(editsByUser),
      editsByAction: this.toSortedEntries(editsByAction)
    };
  }

  toSortedEntries(obj) {
    return Object.entries(obj).sort((a, b) => b[1] - a[1]);
  }

  extractProperties(comment = '') {
    const regex = /\[\[Property:(P\d+)\]\]/gm;
    const matches = [...comment.matchAll(regex)].map((m) => m[1]);
    return [...new Set(matches)];
  }

  getActionFromComment(comment = '') {
    const action = comment.match(/\/\*\s([^:]+):/);
    if (action && action[1]) {
      return action[1].trim();
    }
    if (!comment.trim()) {
      return 'No summary';
    }
    return 'Other';
  }

  createHtml(data) {
    const generated = this.formatDateTime(data.nowIso);
    const since = data.sinceTimestamp ? this.formatDateTime(data.sinceTimestamp) : 'First run (includes latest available edits)';

    const summaryCards = [
      this.metricCard('Watched Items', data.watchCount),
      this.metricCard('Changed Items', data.changedItemCount),
      this.metricCard('Total Edits', data.totalEdits),
      this.metricCard('Properties Touched', data.uniquePropertyCount)
    ].join('\n');

    const usersTableRows = data.editsByUser
      .slice(0, 15)
      .map(([user, count]) => `<tr><td>${this.escapeHtml(user)}</td><td>${count}</td></tr>`)
      .join('\n');

    const actionTableRows = data.editsByAction
      .slice(0, 15)
      .map(([action, count]) => `<tr><td>${this.escapeHtml(action)}</td><td>${count}</td></tr>`)
      .join('\n');

    const timelineRows = data.editsFlat
      .map((edit) => {
        const props = edit.properties.length ? edit.properties.join(', ') : '-';
        return `<tr>
<td>${this.formatDateTime(edit.timestamp)}</td>
<td><a target="_blank" href="${this.config.site}/wiki/${edit.qid}">${this.escapeHtml(edit.item_label)}</a></td>
<td>${this.escapeHtml(edit.user)}</td>
<td>${this.escapeHtml(edit.action)}</td>
<td>${this.escapeHtml(props)}</td>
<td>${this.escapeHtml(edit.comment || '-')}</td>
</tr>`;
      })
      .join('\n');

    const perItemSections = data.itemsWithEdits
      .map((row) => {
        const rows = row.edits
          .map((edit) => {
            const props = edit.properties.length ? edit.properties.join(', ') : '-';
            return `<tr>
<td>${this.formatDateTime(edit.timestamp)}</td>
<td>${this.escapeHtml(edit.user)}</td>
<td>${this.escapeHtml(edit.action)}</td>
<td>${this.escapeHtml(props)}</td>
<td>${this.escapeHtml(edit.comment || '-')}</td>
</tr>`;
          })
          .join('\n');

        return `<details class="item-block">
<summary>${this.escapeHtml(row.item.label || row.item._id)} (${row.item._id}) - ${row.edits.length} edits</summary>
<div class="table-wrap">
<table>
<thead><tr><th>Time</th><th>User</th><th>Action</th><th>Properties</th><th>Summary</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
</details>`;
      })
      .join('\n');

    const truncationNote = data.truncatedItems
      ? `<p class="warning">Note: ${data.truncatedItems} item(s) hit rvlimit=${this.config.rvlimit}. Some older edits after last run may be missing.</p>`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>WD-Watch V2 report ${this.escapeHtml(data.wdset)}</title>
<link rel="stylesheet" href="../css/report.css" />
</head>
<body>
<main class="page">
<header class="hero">
<p class="eyebrow">Wikidata Monitoring Report</p>
<h1>WD-Watch V2: ${this.escapeHtml(data.wdset)}</h1>
<p class="subtitle">Generated ${generated}</p>
<p class="subtitle">Changes since: ${since}</p>
<p class="subtitle">Project: <a target="_blank" href="https://github.com/OSC-JYU/wd-watch">github.com/OSC-JYU/wd-watch</a></p>
</header>

<section class="cards">
${summaryCards}
</section>

${truncationNote}

<section class="grid-2">
<article class="panel">
<h2>Top Editors</h2>
<div class="table-wrap">
<table>
<thead><tr><th>User</th><th>Edits</th></tr></thead>
<tbody>${usersTableRows || '<tr><td colspan="2">No edits</td></tr>'}</tbody>
</table>
</div>
</article>
<article class="panel">
<h2>Action Types</h2>
<div class="table-wrap">
<table>
<thead><tr><th>Action</th><th>Count</th></tr></thead>
<tbody>${actionTableRows || '<tr><td colspan="2">No edits</td></tr>'}</tbody>
</table>
</div>
</article>
</section>

<section class="panel">
<h2>Timeline (All Edits)</h2>
<div class="table-wrap">
<table>
<thead><tr><th>Time</th><th>Item</th><th>User</th><th>Action</th><th>Properties</th><th>Summary</th></tr></thead>
<tbody>${timelineRows || '<tr><td colspan="6">No edits since previous run</td></tr>'}</tbody>
</table>
</div>
</section>

<section class="panel">
<h2>Per Item Details</h2>
${perItemSections || '<p>No item updates since previous run.</p>'}
</section>
</main>
</body>
</html>`;
  }

  metricCard(label, value) {
    return `<article class="card"><p>${label}</p><strong>${value}</strong></article>`;
  }

  formatDateTime(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return isoString;
    }
    return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
  }

  getDateFilePart(now) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}_${hh}${mm}`;
  }

  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};
