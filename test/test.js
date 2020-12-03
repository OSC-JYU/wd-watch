

let chai = require('chai');
let chaiHttp = require('chai-http');
let should = chai.should();


let url = "http://localhost:8101";

const venus_id = "Q179482"

chai.use(chaiHttp);


describe('Watchlist item', () => {

	describe('/POST item', () => {
		it('should delete item from wathclist', (done) => {
			chai.request(url)
				.delete('/api/watchlist/' + venus_id)
				.end((err, res) => {
					res.should.have.status(200);
					done();
				});
		});
	});

	describe('/POST item', () => {
		it('should create item in wathclist', (done) => {
			let item = {
				_id: venus_id,
				wdset: 'test-set1'
			};
			chai.request(url)
				.post('/api/watchlist')
				.send(item)
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

	describe('/GET wathclist items in test-set1', () => {
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


describe('Watchlist check', () => {
	describe('/POST check', () => {
		it('should check wathclist', (done) => {
			chai.request(url)
				.post('/api/watchlist/check?wdset=test-set1')
				.send({})
				.end((err, res) => {
					res.should.have.status(200);
					res.body.should.have.property('edited',1);
					done();
				});
		});
	});
});
