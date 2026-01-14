
const fs 		= require('fs/promises')
const path 		= require('path')
const axios		= require('axios')
const nodemailer 	= require("nodemailer");

const head = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="fi" xml:lang="fi">

<head>
	<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
	<meta http-equiv="cache-control" content="no-cache" />

	<!--[if lt IE 7]></base><![endif]-->

	<link href="../css/bootstrap.css" rel="stylesheet">
	<link href="./../css/overrides.css" rel="stylesheet">
	<style>

	body {
		font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
		font-size: 14px;
		line-height: 1.42857143;
		color: #333;
	  }

	  h4 {
		margin-top:20px;
	}


	.site-logo-container {
		background-color: #002957;
		color: white;
		padding: 10px;
	}
	
	table {
		margin-top: 20px;
	}
	table td {
		min-width: 250px;
	}
	</style>

	<title>WD-Watch</title>
</head>

<body>

	<header class="site-header container-fluid hidden-print">
	  <div class="site-brand-container container">
		<div class="row">
		  <div class="col-2 col-sm-2 col-md-10 col-xl-7 site-logo-container">
			<p class="hidden-sm-down site-name">
			  <h2>WD-watch</h2>
			</p>
		  </div>
		</div>
	  </div>
	</header>

<div class="container">
<div class="col-md-12 col-lg-12 col-xl-12 main">

<img src = "../images/gardener.svg" alt="My Happy gardener" style="position: absolute; right:0px; height:120px; margin-top:60px"/>
`

module.exports = class Report {

	constructor(config) {
		this.config = config
		console.log('mailer:', config.mailer )
		console.log('mailer port:', config.mailer_port )

		// Configure axios with default user agent from config
		axios.defaults.headers.common['User-Agent'] = config.user_agent || 'WD-Watch/1.0'

		this.transporter = nodemailer.createTransport({
			host: config.mailer,
			port: config.mailer_port,
			secure: false,
			tls: { minVersion: 'TLSv1', rejectUnauthorized: false }
  		});


	}

	getHead() {
		return head
	}

	async create(wdset, db, mode, mail) {
		try {
			const date = new Date()
			let day = date.getDate();
			let month = date.getMonth() + 1;
			let year = date.getFullYear();
			var today = `${year}-${month}-${day}`;
			var filename = wdset + '_' + today + '.html'

			var items = await this.getEdits(wdset, db, mode)
			const report = this.parseEdits(items, wdset)
			report.property_labels = await this.getLabels(report.property_set)
			report.wid_labels = await this.getLabels(report.wid_set)
			report.action_labels = await this.getActionLabels()
			var html = this.createHTML(report, wdset)

			await fs.writeFile(path.join('public', 'reports', filename), html);
			if (mail) await this.sendMail(mail, wdset, html)
			return '/reports/' + filename
		} catch (err) {
			console.log(err);
			throw(err)
		}
	}

	async sendMail(email, wdset, html) {


		var message = {
			from: "nobody@jyu.fi",
			to: email,
			subject: `WD-watch report: ${wdset}`, // Subject line
			text: "raportti", // plain text body
			html: `${html}` // html body
		}
	
		const info = await this.transporter.sendMail(message)
		console.log("Message sent: %s", info.messageId);
		return info.messageId
	
	}
	

	async getEdits(wdset, db, mode) {
		console.log('checking edits...')
		const property_regex = /\[\[Property:(.*?)\]\]:(.*?),/gm;
		var count = 0;
		var total = 0
		var query = {wdset: wdset}
		var items = await db.watchlist.find(query)
		if(items.length === 0) throw('no items found')
		for(var item of items) {
			total++
			if(!item.label && (item.item.itemLabel && item.item.itemLabel.value)) {
				item.label = item.item.itemLabel.value
			}
			var url = this.config.site + "/w/api.php?action=query&format=json&prop=revisions&titles=" + item._id + "&rvprop=ids|timestamp|flags|comment|user&rvlimit=" + this.config.rvlimit + "&rvdir=older"
			console.log(url)
			var result = await axios(url)
			var json = result.data
			var key = Object.keys(json.query.pages)

			if(!item.edit_count) mode = 'all' // in first run we get all edits
			var timestamp = json.query.pages[key[0]].revisions[0].timestamp; // timestamp of latest edit
			if(mode == 'all' || timestamp != item.latest_edit) {
				// we have an edit, now check how many edits there are after last check
				var edit_count = 0
				item.edits = []
				for(var i=0; i < this.config.rvlimit; i++) {
					if(json.query.pages[key[0]].revisions[i]) {
						if(mode == 'all' || item.latest_edit != json.query.pages[key[0]].revisions[i].timestamp) {
							edit_count++
							var edit_obj = {}
							edit_obj.comment = json.query.pages[key[0]].revisions[i].comment + '#'
							edit_obj.user = json.query.pages[key[0]].revisions[i].user
							edit_obj.time = json.query.pages[key[0]].revisions[i].timestamp
							item.edits.push(edit_obj)
						}
					}
				}
				var update = {
					latest_edit: timestamp,
					edit_count: edit_count
				}
				var response = await db.watchlist.update({_id: item._id}, {$set: update}, {returnUpdatedDocs:1})
				count++;
			} else {
				console.log('no change ' + item.label)
			}

		}
		return items
	}



	parseEdits(items, wdset) {
		const action_regex = /\/* (.*):.\|/gm;
		const label_regex = /((\|)(..)).*\*\/(.*?)((\[\[)|(,)|#)/gm;
		const lang_regex = /(\|)(..)/gm;
		const property_regex = /\[\[Property:(.*?)\]\]:(.*?),/gm;
		const wid_regex = /\[\[Q(.*?)\]\]/gm;
		var report = {}
		report.translations_added = []
		report.edited_labels = []
		report.descriptions = []
		report.properties = []

		report.property_set = new Set()
		report.wid_set = new Set()
		report.edit_count = 0
		report.total_count = 0

		for(var item of items) {
			report.total_count++
			if(item.edits && item.edits.length) {
				for(var edit of item.edits) {
					if(edit.comment.includes('wbsetlabel-add:')) {
						var transl = this.getRegex(label_regex, edit, 4)
						var lang = this.getRegex(lang_regex, edit, 2)
						var obj = {item: item, edit: edit, transl: transl, lang: lang}
						report.translations_added.push(obj)
						report.edit_count++
					} else if (edit.comment.includes('wbsetlabel-set:')) {
						var transl = this.getRegex(label_regex, edit, 4)
						var lang = this.getRegex(lang_regex, edit, 2)
						var obj = {item: item, edit: edit, transl: transl, lang: lang}
						report.edited_labels.push(obj)
						report.edit_count++
					} else if (edit.comment.includes('wbsetdescription-add')) {
						var value = this.getRegex(label_regex, edit, 4)
						var lang = this.getRegex(lang_regex, edit, 2)
						var obj = {item: item, edit: edit, value: value, lang: lang}
						report.descriptions.push(obj)
						report.edit_count++

					} else if (edit.comment.includes('[[Property:P')) {
						var property = this.getRegex(property_regex, edit, 1)
						var wid = this.getRegex(wid_regex, edit, 1)
						var value = this.getRegex(property_regex, edit, 2)
						var action = this.getRegex(action_regex, edit, 1)
						if(wid) wid = 'Q' + wid

						if(this.checkProperty(property, wdset)) {

							var obj = {item: item, edit: edit, property, property, wid: wid, value: value, action:action}
							report.properties.push(obj)
							report.property_set.add(property)
							if(wid.startsWith('Q')) report.wid_set.add(wid)
							report.edit_count++
						}
					}

				}
			}
		}

		return report

	}



	checkProperty(property, wdset) {
		
		if(!property) return false
		// if "wdset" is defined and its has key "properties" then allow only properties listed
		if(this.config.wdsets && this.config.wdsets[wdset] && this.config.wdsets[wdset].properties) {
			if(this.config.wdsets[wdset].properties.includes(property)) {
				return true
			} else {
				return false
			}
		}
		// otherwise show all
		return true
	}



	createHTML(report, wdset) {

		var date = this.getDate()

		var html = head
		html += `<h1>${this.config.main_title} (${wdset})</h1>`
		html += `<p>${this.config.title_item_count}: ${report.total_count} </p>\n\n`
		html += `<p>${this.config.title_edit_count}: ${report.edit_count} </p>\n\n`
		html += `<p>${this.config.title_report_date}: ${date} </p>\n\n`

		// TOC
		if(report.translations_added.length) {
			html += `<a href="#title_translations"><h4>${this.config.title_translations_added} (${report.translations_added.length})</h4></a>`
		}
		if(report.edited_labels.length) {
			html += `<a href="#modified_labels"><h4>${this.config.title_translations_edited} (${report.edited_labels.length})</h4></a>`
		}
		if(report.descriptions.length) {
			html += `<a href="#descriptions"><h4>${this.config.title_descriptions} (${report.descriptions.length})</h4></a>`
		}
		if(report.properties.length) {
			html += `<a href="#properties"><h4>${this.config.title_properties} (${report.properties.length})</h4></a>`
		}

		var prev_item = null


		// added translations
		if(report.translations_added.length) {
			html += `<a name="title_translations"><br></a><h2>${this.config.title_translations_added} (${report.translations_added.length})</h2>`
			html += '<ul>\n'
			for(var edit of report.translations_added) {
				if(prev_item != edit.item._id) {
					html += "  <li><a target='_blank' href='" + this.config.site + '/wiki/' + edit.item._id + "'> <h4>" + edit.item.label + "</h4></a></li>\n"
					html += "  <div>lang: <b>" + edit.lang + "</b> " + edit.transl + "</div>\n"
				} else {
					html += "  <div>lang: <b>" + edit.lang + "</b> " + edit.transl + "</div>\n"
				}
				prev_item = edit.item._id
			}
			html += "</ul>\n\n"
		}


		// modified labels
		if(report.edited_labels.length) {
			html += `<a name="modified_labels"><br></a><h2>${this.config.title_translations_edited} (${report.edited_labels.length})</h2>`
			html += '<ul>\n'
			prev_item = null
			for(edit of report.edited_labels) {
				if(prev_item != edit.item._id) {
					html += "  <li><a target='_blank' href='" + this.config.site + '/wiki/' + edit.item._id + "'> <h4>" + edit.item.label + "</h4></a></li>\n"
					html += "  <div>lang: <b>" + edit.lang + "</b> " + edit.transl + "</div>\n"
				} else {
					html += "  <div>lang: <b>" + edit.lang + "</b> " + edit.transl + "</div>\n"
				}
				prev_item = edit.item._id
			}
			html += "</ul>\n"
		}

		// descriptions
		if(report.descriptions.length) {
			html += `<a name="descriptions"><br></a><h2>${this.config.title_descriptions} (${report.descriptions.length})</h2>`
			html += '<ul>\n'
			prev_item = null
			for(edit of report.descriptions) {
				if(prev_item != edit.item._id) {
					html += "  <li><a target='_blank' href='" + this.config.site + '/wiki/' + edit.item._id + "'> <h4>" + edit.item.label + "</h4></a></li>\n"
					html += "  <div>lang: <b>" + edit.lang + "</b> " + edit.value + "</div>\n"
				} else {
					html += "  <div>lang: <b>" + edit.lang + "</b> " + edit.value + "</div>\n"
				}
				prev_item = edit.item._id
			}
			html += "</ul>\n"
		}

		// properties
		if(report.properties.length) {
			html += `<a name="properties"><br></a><h2>${this.config.title_properties} (${report.properties.length})</h2>`
			html += '<ul>\n'
			prev_item = null
			for(edit of report.properties) {
				var property_label = edit.property
				if(report.property_labels[edit.property] && report.property_labels[edit.property].labels &&  report.property_labels[edit.property].labels[this.config.preferred_lang]) {
					property_label = report.property_labels[edit.property].labels[this.config.preferred_lang].value
				}
				if(prev_item != edit.item._id) {
					html += "  <li><a target='_blank' href='" + this.config.site + '/wiki/' + edit.item._id + "'> <h4>" + edit.item.label + "</h4></a></li>\n"
					html += `  <div>${report.action_labels[edit.action]} <b>${property_label}</b> (${edit.property}) ${this.WDLink(edit, report.wid_labels)}</div>\n`
				} else {
					html += `  <div>${report.action_labels[edit.action]} <b>${property_label}</b> (${edit.property}) ${this.WDLink(edit, report.wid_labels)} ${edit.value}</div> \n`
				}
				prev_item = edit.item._id
			}
			html += "</ul>\n"
		}


		return html

	}



	WDLink(edit, labels) {
		if(edit.wid) {
			var link_title = edit.wid
			if(labels[edit.wid].labels[this.config.preferred_lang])
				link_title = labels[edit.wid].labels[this.config.preferred_lang].value
			else if(labels[edit.wid].labels.en)
				link_title = labels[edit.wid].labels.en.value
			return `<a target="_blank" href="${this.config.site}/wiki/${edit.wid}">${link_title}</a>`
		} else if(!edit.value.trim().startsWith('[[Q')) return edit.value
		else return ''
	}


	async getLabels(set) {
		var arr = [...set]
		var entities = {}
		var chunks = this.getChunks(arr, 25)
		for(var chunk of chunks) {
			var url = `${this.config.site}/w/api.php?action=wbgetentities&format=json&ids=${chunk.join('|')}&props=labels%7Cdescriptions&languages=${this.config.preferred_lang}|en&formatversion=2`
			console.log(url)
			var response = await axios.get(url)
			entities = {...entities, ...response.data.entities}
		}
		return entities
	}



	getChunks(array, chunk_size) {
		var chunks = []
		for (let i = 0; i < array.length; i += chunk_size) {
			const chunk = array.slice(i, i + chunk_size);
			chunks.push(chunk)
		}
		return chunks
	}



	async getActionLabels() {
		var plural_regex = /{{(PLURAL:..)\|(.*)\|/gm
		var labels = {}
		const url = `https://www.mediawiki.org/w/api.php?action=query&meta=allmessages&amprefix=wikibase-entity-summary&amlang=${this.config.preferred_lang}&format=json`
		var response = await axios.get(url)
		for(var msg of response.data.query.allmessages) {
			var label = msg.name.replace('wikibase-entity-summary-','')
			var transl = msg['*']
			if(transl.includes('{{PLURAL:')) {
				var plural = this.getRegex(plural_regex, transl, 2)
				transl = transl.replace(/{{PLURAL:.*}}/, plural)
			}
			labels[label] = transl
		}
		return labels
	}


	getDate() {
		const date = new Date();
		let day = date.getDate();
		let month = date.getMonth() + 1;
		let year = date.getFullYear();
		return `${day}-${month}-${year}`
	}



	getRegex(regex, edit, group) {
		var str = ''
		if(edit.comment) str = edit.comment
		else str = edit
		const array = [...str.matchAll(regex)]
		if(array[0] && array[0][group])
			return array[0][group]
		return ''

	}
}
