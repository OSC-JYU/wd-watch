
var server = "https://tools.oscapps.jyu.fi";
var wd_server = "https://test.wikidata.org/"


var g_local_dev = false;
if(window.location.href.indexOf("file") === 0|| window.location.href.indexOf("http://localhost") === 0) {
	g_local_dev = true;
}


if(g_local_dev) server = "";

var config = {
	api_url: server + "/wd-watch/api",
	local_dev: g_local_dev,
	wd_server: wd_server
};


if(g_local_dev) {
	config.api_url = server + "/api"
}
