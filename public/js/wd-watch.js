function kakeAdmin () {
	
	var self = this;
	this.collection 	= null;
	this.currentDoc 	= null;
	this.items			= null;







	this.init = function () {

		// happens when user clicks back arrow from browser after opening an article
		window.onpopstate = function(event) {
			//if(!event.state && self.items)  {
				//self.renderMain();
			//} 
		};
		self.renderMain()
		
	};



	this.renderMain = async function() {

		$("#info").hide();
		$("#items").show().empty().append("<div class='alert alert-info'>Haen tietoja...</div>");
		
		try {
			var result = await fetch(config.api_url + "/watchlist?status=edited", {credentials: "include"} );
			self.items = await result.json();
			self.renderItems();
			self.renderItemCount()

		} catch(e) {
			console.log(e)
		}
		//if(self.items && self.items["updated"]) $("#updated-count").text(self.items["updated"].length);		
	}

	this.renderItemCount = async function() {
		var result = await fetch("/api/watchlist?mode=count", {credentials: "include"} );
		var json = await result.json();
		if(json && json.count) $("#item-count").text('Wikidatakohteita ' + json.count);
	}

	this.checkEdits = async function() {
		$("#items").empty().append('tarkistan...');
		var result = await fetch("/api/watchlist/check", {method: 'POST', credentials: "include"} );
		var json = await result.json();
		self.renderMain();
	}

	this.approveEdit = async function(qid) {
		$("#items").empty().append('päivitän ...');
		var result = await fetch("/api/watchlist/" + qid, {method: 'PUT', credentials: "include"} );
		var json = await result.json();
		self.renderMain();
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
			html += "  <td><button data-id='" + item._id + "' class='button rev-approve'>muutokset OK</button></td>";
			html += "</tr>";
		}	
		$("#items").empty().append(html + "</table>");
		if(self.items.length == 0) $("#items").empty().append("<div class='alert alert-info'>ei muokkauksia</div>");
	}





	this.addWikidataItem = async function(qid) {
		
		try {
			var url = config.api_url + "/wikidata/" +  qid
			var result = await fetch(url);
			json = await result.json();
			
			var doc = {_id: qid, label: {}, modified: json.entities[qid].modified}

			if(json.entities[qid].labels.en)
				doc.label = json.entities[qid].labels.en.value

			if(json.entities[qid].labels.fi)
				doc.label = json.entities[qid].labels.fi.value

			var result = await fetch("/api/watchlist", {method: "POST", body: JSON.stringify(doc), credentials: "include"});
			
			self.renderMain()
			$("#info").show().text('lisätty ' + doc.label)
			
		} catch(e) {
			alert('lisäys epäonnistui ' + e)
		}

		
		//alert(result.entities.Q42.labels.fi.value)

	}




	this.updateDoc = async function(collection, id, update) {
		var url = config.gp_url + "/collections/" + collection + "/"+ id;
		var result = await fetch(url, {method: "PUT", body: JSON.stringify(update), credentials: "include"});
		result = await result.json();
		return result;
	}

	this.fetchReservedItems = async function() {
		// fetch items that are in workflow from GLAMpipe
		try {
			self.reserved_items = await $.getJSON(config.gp_url + "/collections/" + config.gp_collection + "/docs?limit=1000" );
		} catch(e) {
			$("#items").empty().append("<div class='alert alert-danger'>Virhe tietojen haussa GLAMpipesta!</div>Kokeile uudestaan, ja jos ei auta niin laita postia jyx-support@jyu.fi.");
			return;
		}
	}


	this.fetchNewItems = async function() {
		// fetch items that are in workflow from GLAMpipe
		try {
			self.ready_items = await fetch(config.gp_url + "/collections/" + config.gp_collection_processed + "/docs?limit=1000", {credentials: "include"} );
		} catch(e) {
			$("#items").empty().append("<div class='alert alert-danger'>Virhe tietojen haussa GLAMpipesta!</div>Kokeile uudestaan, ja jos ei auta niin laita postia jyx-support@jyu.fi.");
			return;
		}
	}


	this.addMessage = function(msg, cl, div_id) {
		if(div_id) {
			$("#" + div_id).append("<div class='alert alert-"+cl+"'>" + msg + "</div>");
		} else {
			$("#messages").append("<div class='alert alert-"+cl+"'>" + msg + "</div>");
		}
	}




}



function getDate (str) {
	var date_str = str.replace("OPIN2JYX_", "");
	var date = new Date(date_str);
	return date.toLocaleDateString();
	
};

function dateFromObjectId (objectId) {
	var date = new Date(parseInt(objectId.substring(0, 8), 16) * 1000);
	return date.getFullYear() + "-" + ("0" + (date.getMonth()+1)).slice(-2) + "-" + ("0" + date.getDate()).slice(-2);
};


