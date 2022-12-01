

let chai = require('chai');
let chaiHttp = require('chai-http');
let should = chai.should();


let url = "http://localhost:8200";

const venus_id = "Q179482"

chai.use(chaiHttp);


describe('Watchlist item', () => {

	describe('/POST item', () => {
		it('should create item in wathclist', (done) => {
			chai.request(url)
				.post('/api/watchlist/' + venus_id + '?wdset=test-set1')
				.end((err, res) => {
					res.should.have.status(200);
					res.body.should.be.a('object');
					res.body.should.have.property('_id');
					done();
				});
		});
	});

	describe('/GET wathclist item', () => {
		it('should get item created', (done) => {
			chai.request(url)
				.get('/api/watchlist/' + venus_id)
				.end((err, res) => {
					res.should.have.status(200);
					res.body.should.be.a('object');
					chai.expect(res.body).to.have.property("wdset", "test-set1");
					done();
				});
		});
	});

	describe('/GET items in test-set1', () => {
		it('get all items in test-set1', (done) => {
			chai.request(url)
				.get('/api/watchlist?wdset=test-set1')
				.end((err, res) => {
					res.should.have.status(200);
					res.body.should.be.a('array');
					res.body.length.should.be.eql(1);
					done();
				});
		});
	});

});

describe('/GET set count', () => {
	it('test-set1 should have zero items', (done) => {
		chai.request(url)
			.get('/api/watchlist/sets')
			.end((err, res) => {
				res.should.have.status(200);
				res.body.should.be.a('object');
				chai.expect(res.body).to.have.property('test-set1');
				done();
			});
	});
});

describe('Watchlist check', () => {

	describe('/POST create report', () => {
		it('should check changes in wathclist', (done) => {
			chai.request(url)
				.post('/api/watchlist/report?wdset=test-set1')
				.end((err, res) => {
					res.should.have.status(200);
					done();
				});
		});
	});

	describe('/GET checked item', () => {
		it('item should be "edit_count"', (done) => {
			chai.request(url)
				.get('/api/watchlist/' + venus_id)
				.end((err, res) => {
					res.should.have.status(200);
					res.body.should.be.a('object');
					chai.expect(res.body).to.have.property("edit_count");
					done();
				});
		});
	});

	describe('/DELETE remove item', () => {
		it('should delete item from wathclist', (done) => {
			chai.request(url)
				.delete('/api/watchlist/' + venus_id)
				.end((err, res) => {
					res.should.have.status(200);
					done();
				});
		});
	});

});


describe('Sparql import', () => {

	describe('/POST get items from Sparql', () => {
		it('make query', (done) => {
			const sparql = `SELECT ?item ?itemLabel
			      WHERE
			      {
			        ?item wdt:P31 wd:Q3305213 .
			        ?item wdt:P170 wd:Q34661 .
			         SERVICE wikibase:label { bd:serviceParam wikibase:language "fi,en". }
			      }
			      limit 200`
			chai.request(url)
				.post('/api/watchlist/query?query=' + sparql + '&wdset=Klimt')
				.end((err, res) => {
					res.should.have.status(200);
					done();
				});
		});
	});

	describe('/GET items in Klimt', () => {
		it('get all items in test-set1', (done) => {
			chai.request(url)
				.get('/api/watchlist?wdset=Klimt')
				.end((err, res) => {
					res.should.have.status(200);
					res.body.should.be.a('array');
					res.body.length.should.be.eql(10);
					done();
				});
		});
	});

});
