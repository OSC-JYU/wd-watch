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

  async create(wdset, db, mail, options = {}) {
    const now = new Date();
    const nowIso = now.toISOString();

    const lastRun = await db.runs.findOne({ wdset });
    const editPeriodDays = Number.isInteger(options.editPeriodDays) ? options.editPeriodDays : null;

    let sinceTimestamp = lastRun && lastRun.last_run ? lastRun.last_run : null;
    let sinceSource = sinceTimestamp ? 'last_run' : 'first_run';

    if (editPeriodDays) {
      sinceTimestamp = new Date(now.getTime() - editPeriodDays * 24 * 60 * 60 * 1000).toISOString();
      sinceSource = `period_${editPeriodDays}_days`;
    }

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

    const reportTemplate = options.reportTemplate || 'email-safe';
    let html;
    if (reportTemplate === 'web') {
      const inlineCss = await this.getInlineReportCss();
      html = this.createHtml(reportData, inlineCss);
    } else {
      html = this.createEmailSafeHtml(reportData);
    }

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
      since_source: sinceSource,
      edit_period_days: editPeriodDays,
      report_template: reportTemplate,
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

  createHtml(data, inlineCss = '') {
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
      <summary><a target="_blank" href="${this.config.site}/wiki/${row.item._id}">${this.escapeHtml(row.item.label || row.item._id)} (${row.item._id})</a> - ${row.edits.length} edits</summary>
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
<style>
${inlineCss}
</style>
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

  createEmailSafeHtml(data) {
    const generated = this.formatDateTime(data.nowIso);
    const since = data.sinceTimestamp ? this.formatDateTime(data.sinceTimestamp) : 'First run (includes latest available edits)';

    const styles = {
      body: 'margin:0;padding:0;background:#f7f4ef;color:#1f2a30;font-family:Arial,Helvetica,sans-serif;line-height:1.4;',
      container: 'max-width:900px;margin:0 auto;padding:16px;',
      panel: 'background:#ffffff;border:1px solid #dfd4c6;border-radius:8px;padding:14px;margin-bottom:14px;',
      h1: 'margin:0 0 8px 0;font-size:24px;line-height:1.2;color:#9a3412;',
      h2: 'margin:0 0 8px 0;font-size:18px;line-height:1.3;color:#0f766e;',
      p: 'margin:4px 0;color:#374151;font-size:14px;',
      table: 'width:100%;border-collapse:collapse;margin-top:8px;',
      th: 'text-align:left;padding:8px;border:1px solid #e7e0d4;background:#faf6ef;font-size:13px;',
      td: 'text-align:left;vertical-align:top;padding:8px;border:1px solid #e7e0d4;font-size:13px;',
      metricLabel: 'padding:8px;border:1px solid #e7e0d4;background:#faf6ef;font-size:13px;color:#374151;',
      metricValue: 'padding:8px;border:1px solid #e7e0d4;font-size:16px;font-weight:bold;color:#9a3412;',
      warning: 'margin:0 0 12px 0;padding:10px;border:1px solid #f4b4b4;border-radius:6px;background:#fde8e8;color:#7f1d1d;font-size:13px;'
    };

    const userRows = data.editsByUser
      .slice(0, 15)
      .map(([user, count]) => `<tr><td style="${styles.td}">${this.escapeHtml(user)}</td><td style="${styles.td}">${count}</td></tr>`)
      .join('');

    const actionRows = data.editsByAction
      .slice(0, 15)
      .map(([action, count]) => `<tr><td style="${styles.td}">${this.escapeHtml(action)}</td><td style="${styles.td}">${count}</td></tr>`)
      .join('');

    const timelineRows = data.editsFlat
      .map((edit) => {
        const props = edit.properties.length ? edit.properties.join(', ') : '-';
        return `<tr>
<td style="${styles.td}">${this.formatDateTime(edit.timestamp)}</td>
<td style="${styles.td}"><a target="_blank" href="${this.config.site}/wiki/${edit.qid}">${this.escapeHtml(edit.item_label)}</a></td>
<td style="${styles.td}">${this.escapeHtml(edit.user)}</td>
<td style="${styles.td}">${this.escapeHtml(edit.action)}</td>
<td style="${styles.td}">${this.escapeHtml(props)}</td>
<td style="${styles.td}">${this.escapeHtml(edit.comment || '-')}</td>
</tr>`;
      })
      .join('');

    const perItemBlocks = data.itemsWithEdits
      .map((row) => {
        const itemRows = row.edits
          .map((edit) => {
            const props = edit.properties.length ? edit.properties.join(', ') : '-';
            return `<tr>
<td style="${styles.td}">${this.formatDateTime(edit.timestamp)}</td>
<td style="${styles.td}">${this.escapeHtml(edit.user)}</td>
<td style="${styles.td}">${this.escapeHtml(edit.action)}</td>
<td style="${styles.td}">${this.escapeHtml(props)}</td>
<td style="${styles.td}">${this.escapeHtml(edit.comment || '-')}</td>
</tr>`;
          })
          .join('');

        return `<div style="${styles.panel}">
<h3 style="margin:0 0 6px 0;font-size:16px;color:#9a3412;"><a target="_blank" href="${this.config.site}/wiki/${row.item._id}">${this.escapeHtml(row.item.label || row.item._id)} (${row.item._id})</a> - ${row.edits.length} edits</h3>
<table style="${styles.table}">
<thead><tr><th style="${styles.th}">Time</th><th style="${styles.th}">User</th><th style="${styles.th}">Action</th><th style="${styles.th}">Properties</th><th style="${styles.th}">Summary</th></tr></thead>
<tbody>${itemRows}</tbody>
</table>
</div>`;
      })
      .join('');

    const truncationNote = data.truncatedItems
      ? `<p style="${styles.warning}">Note: ${data.truncatedItems} item(s) hit rvlimit=${this.config.rvlimit}. Some older edits after last run may be missing.</p>`
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>WD-Watch report ${this.escapeHtml(data.wdset)}</title>
</head>
<body style="${styles.body}">
<div style="${styles.container}">
<div style="${styles.panel}">
<h1 style="${styles.h1}">WD-Watch: ${this.escapeHtml(data.wdset)}</h1>
<p style="${styles.p}">Generated: ${generated}</p>
<p style="${styles.p}">Changes since: ${since}</p>
<p style="${styles.p}">Project: <a target="_blank" href="https://github.com/OSC-JYU/wd-watch">github.com/OSC-JYU/wd-watch</a></p>

<table style="${styles.table}">
<tbody>
<tr><td style="${styles.metricLabel}">Watched Items</td><td style="${styles.metricValue}">${data.watchCount}</td></tr>
<tr><td style="${styles.metricLabel}">Changed Items</td><td style="${styles.metricValue}">${data.changedItemCount}</td></tr>
<tr><td style="${styles.metricLabel}">Total Edits</td><td style="${styles.metricValue}">${data.totalEdits}</td></tr>
<tr><td style="${styles.metricLabel}">Properties Touched</td><td style="${styles.metricValue}">${data.uniquePropertyCount}</td></tr>
</tbody>
</table>
</div>

${truncationNote}

<div style="${styles.panel}">
<h2 style="${styles.h2}">Top Editors</h2>
<table style="${styles.table}">
<thead><tr><th style="${styles.th}">User</th><th style="${styles.th}">Edits</th></tr></thead>
<tbody>${userRows || `<tr><td style="${styles.td}" colspan="2">No edits</td></tr>`}</tbody>
</table>
</div>

<div style="${styles.panel}">
<h2 style="${styles.h2}">Action Types</h2>
<table style="${styles.table}">
<thead><tr><th style="${styles.th}">Action</th><th style="${styles.th}">Count</th></tr></thead>
<tbody>${actionRows || `<tr><td style="${styles.td}" colspan="2">No edits</td></tr>`}</tbody>
</table>
</div>

<div style="${styles.panel}">
<h2 style="${styles.h2}">Timeline (All Edits)</h2>
<table style="${styles.table}">
<thead><tr><th style="${styles.th}">Time</th><th style="${styles.th}">Item</th><th style="${styles.th}">User</th><th style="${styles.th}">Action</th><th style="${styles.th}">Properties</th><th style="${styles.th}">Summary</th></tr></thead>
<tbody>${timelineRows || `<tr><td style="${styles.td}" colspan="6">No edits since previous run</td></tr>`}</tbody>
</table>
</div>

<div style="${styles.panel}">
<h2 style="${styles.h2}">Per Item Details</h2>
${perItemBlocks || `<p style="${styles.p}">No item updates since previous run.</p>`}
</div>
</div>
</body>
</html>`;
  }

  async getInlineReportCss() {
    try {
      const cssPath = path.join(__dirname, 'public', 'css', 'report.css');
      return await fs.readFile(cssPath, 'utf8');
    } catch (err) {
      return '';
    }
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
