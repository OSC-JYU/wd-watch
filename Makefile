IMAGES := $(shell docker images -f "dangling=true" -q)
CONTAINERS := $(shell docker ps -a -q -f status=exited)
VOLUME := wd-watch-data
REPO := wd-watch


clean:
	docker rm -f $(CONTAINERS)
	docker rmi -f $(IMAGES)

create_volume:
	docker volume create $(VOLUME)

build:
	docker build -t $(REPO):latest .

start:
	docker run -d --name wd-watch \
		-v $(VOLUME):/src/data \
		-e DOCKER_VOLUME=yes \
		-e PORT=8200 \
		-e DEBUG=debug,error \
		-p 8200:8200 \
		 $(REPO):latest

restart:
	docker stop wd-watch
	docker rm wd-watch
	$(MAKE) start

bash:
	docker exec -it wd-watch bash
