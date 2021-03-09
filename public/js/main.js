
var g_user = "";

$( document ).ready(function() {

	$("#setitems").hide()
	$("#info").hide()
	var admin = new WDWatch();
	admin.init();

	
// ***************************
// EVENT HANDLERS
// ***************************

	$("#add-item").click(function(e) {
		e.preventDefault();
		var qid = $("#qid").val();
		if(qid == '') {
			alert('anna Wikidata ID')
		} else {
			var wdset = $("#new_wdset").val();
			admin.addWikidataItem(qid, wdset);
		}
	})

	$("#mass-add-items").click(function(e) {
		e.preventDefault();
		var query = $("#query").val();
		admin.insertFromQuery(query)
		
	})

	$("#wdsets").change(function(e) {
		admin.currentSet = $(this).val()
		$(".wdsets").val($(this).val())
		admin.renderSetItems();
	})

	$("#check").click(function(e) {
		e.preventDefault();
		admin.checkEdits();
	})

	$("#show-all").click(function(e) {
		e.preventDefault();
		admin.renderAll();
	})

	$(document).on("click", ".rev-approve", async function(e) {
		admin.approveEdit($(this).data("id"))
	})

});


	// This will parse a delimited string into an array of
	// arrays. The default delimiter is the comma, but this
	// can be overriden in the second argument.
	function CSVToArray( strData, strDelimiter ){
		// Check to see if the delimiter is defined. If not,
		// then default to comma.
		strDelimiter = (strDelimiter || ",");

		// Create a regular expression to parse the CSV values.
		var objPattern = new RegExp(
			(
				// Delimiters.
				"(\\" + strDelimiter + "|\\r?\\n|\\r|^)" +

				// Quoted fields.
				"(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +

				// Standard fields.
				"([^\"\\" + strDelimiter + "\\r\\n]*))"
			),
			"gi"
			);


		// Create an array to hold our data. Give the array
		// a default empty first row.
		var arrData = [[]];

		// Create an array to hold our individual pattern
		// matching groups.
		var arrMatches = null;


		// Keep looping over the regular expression matches
		// until we can no longer find a match.
		while (arrMatches = objPattern.exec( strData )){

			// Get the delimiter that was found.
			var strMatchedDelimiter = arrMatches[ 1 ];

			// Check to see if the given delimiter has a length
			// (is not the start of string) and if it matches
			// field delimiter. If id does not, then we know
			// that this delimiter is a row delimiter.
			if (
				strMatchedDelimiter.length &&
				(strMatchedDelimiter != strDelimiter)
				){

				// Since we have reached a new row of data,
				// add an empty row to our data array.
				arrData.push( [] );

			}


			// Now that we have our delimiter out of the way,
			// let's check to see which kind of value we
			// captured (quoted or unquoted).
			if (arrMatches[ 2 ]){

				// We found a quoted value. When we capture
				// this value, unescape any double quotes.
				var strMatchedValue = arrMatches[ 2 ].replace(
					new RegExp( "\"\"", "g" ),
					"\""
					);

			} else {

				// We found a non-quoted value.
				var strMatchedValue = arrMatches[ 3 ];

			}


			// Now that we have our value string, let's add
			// it to the data array.
			arrData[ arrData.length - 1 ].push( strMatchedValue );
		}

		// Return the parsed data.
		return( arrData );
	}
