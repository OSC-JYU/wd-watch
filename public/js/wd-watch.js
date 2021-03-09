function WDWatch () {
	
	var self = this;
	this.collection 	= null;
	this.currentDoc 	= null;
	this.currentSet 	= null;
	this.items			= null;
	this.sets			= null;

	this.init = function () {
		
		self.renderMain()
	};



	this.renderMain = async function() {


		//$("#items").show().empty().append("<div class='alert alert-info'>Fetching data ...</div>");
		await self.getSets();

	}

	this.getSets = async function() {
		$("#wdsets").empty()
		try {
			var result = await fetch(config.api_url + "/watchlist/sets", {credentials: "include"} );
			self.sets = await result.json();
			$("#wdsets").append("<option>choose set</option>")
			for(var wdset in self.sets) {
				$("#wdsets").append("<option value='"+wdset+"'>" + wdset + " (" + self.sets[wdset] + " items)</option>")
			}

		} catch(e) {
			console.log(e)
		}
	}


	this.renderSetItems = async function() {
		$("#setitems").show();
		$("#items-all").empty();
		$("#items-header").text('wikidata items [' + self.currentSet + ']')
		try {
			var result = await fetch(config.api_url + "/watchlist?status=edited&wdset=" + self.currentSet, {credentials: "include"} );
			self.items = await result.json();
			self.renderItems();
			self.renderItemCount()

		} catch(e) {
			console.log(e)
		}
	}


	this.renderItemCount = async function() {
		var result = await fetch(config.api_url + "/watchlist?mode=count&wdset=" + self.currentSet, {credentials: "include"} );
		var json = await result.json();
		if(json && json.count) $("#item-count").text('Wikidata items ' + json.count);
	}


	this.renderAll = async function() {
		var result = await fetch(config.api_url + "/watchlist?wdset=" + self.currentSet, {credentials: "include"} );
		var items = await result.json();
		var html = ''
		for(var item of items) {
			html += "<div><a target='_blank' href='" + config.wd_server + '/wiki/' + item._id + "'>" + item._id + ":  " + item.label + "</a></div>"
		}
		$("#items-all").empty().append(html)
	}


	this.checkEdits = async function() {
		$("#items").empty().append('checking ' + self.items.length + ' items ...');
		var result = await fetch(config.api_url + "/watchlist/check?wdset=" + self.currentSet, {method: 'POST', credentials: "include"} );
		var json = await result.json();
		self.renderSetItems();
	}


	this.approveEdit = async function(qid) {
		$("#items").empty().append('updating ...');
		var result = await fetch(config.api_url + "/watchlist/" + qid, {method: 'PUT', credentials: "include"} );
		var json = await result.json();
		self.renderSetItems();
	}


	this.renderItems = function() {
		var html = "<table>";
		for(var item of self.items) {
			html += "<tr>"
			html += "  <td>" + item._id + "</td>";
			if(item.status == 'edited') {
				html += "  <td>" + item.modified + " <div>" + item.comment + "</div><br>" +item.user+ "</td>";
			} else {
				html += "  <td></td>";
			}
			
			html += "  <td><a target='_blank' href='" + config.wd_server + '/wiki/' + item._id + "'> <h4 style='margin-top:0px'>" + item.label + "</h4></a>";
			//html += "  <td><a target='_blank' href='" + config.wd_server + 'w/index.php?title=' + item._id + '&action=history'"' > <h4 style='margin-top:0px'>historia</h4></a>";
			html += "  <td><button data-id='" + item._id + "' class='button rev-approve'>edit OK</button></td>";
			html += "</tr>";
		}	
		$("#items").empty().append(html + "</table>");
		if(self.items.length == 0) $("#items").empty().append("<div class='alert alert-info'>ei muokkauksia</div>");
	}


	this.addWikidataItem = async function(qid, wdset) {
		qid = qid.replace(/ /g,'')
		try {
			var url = config.api_url + "/wikidata/" +  qid
			var result = await fetch(url);
			var json = await result.json();
			
			var doc = {_id: qid, label: {}, modified: json.entities[qid].modified}
			
			// add to current set by default
			if(wdset) doc.wdset = wdset
			else doc.wdset = self.currentSet

			if(json.entities[qid].labels.en)
				doc.label = json.entities[qid].labels.en.value

			if(json.entities[qid].labels.fi)
				doc.label = json.entities[qid].labels.fi.value

			var update_res = await fetch(config.api_url + "/watchlist", {method: "POST", body: JSON.stringify(doc), credentials: "include"});
			var update_json = await update_res.json();
			if(!update_res.ok) throw(update_json.error)
			self.getSets()
			self.renderSetItems()
			$("#info").show().text('added ' + doc.label)
			
		} catch(e) {
			alert('add failed! ' + e)
		}
	}
	
	this.insertFromQuery = async function(query) {
		await fetch(config.api_url + "/watchlist/query?wdset=jotain&query=" + query, {method: "POST"})
	}
}



