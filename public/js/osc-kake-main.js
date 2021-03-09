
var g_user = "";

$( document ).ready(function() {

	var admin = new WDWatch();
	admin.init();

	
// ***************************
// EVENT HANDLERS
// ***************************

	$("#add-item").click(function(e) {
		e.preventDefault();
		var qid = $("#qid").val();
		if(qid == '') 
			alert('anna Wikidata ID')
		else
			admin.addWikidataItem(qid);
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
