IMAGES := $(shell docker images -f "dangling=true" -q)
CONTAINERS := $(shell docker ps -a -q -f status=exited)
VOLUME := wd-watch-data


clean:
	docker rm -f $(CONTAINERS)
	docker rmi -f $(IMAGES)

create_volume:
	docker volume create $(VOLUME)

build:
	docker build -t osc-jyu/wd-watch:latest .

push:
	docker push osc-jyu/wd-watch:latest
	
pull:
	docker pull osc-jyu/wd-watch:latest

start:
	docker run -d --name wd-watch \
		-v $(VOLUME):/src/data \
		-e DOCKER_VOLUME=yes \
		-e DEBUG=debug,error \
		-p 8200:8200 \
		 osc-jyu/wd-watch:latest
restart: 
	docker stop wd-watch
	docker rm wd-watch
	$(MAKE) start

bash:
	docker exec -it wd-watch bash


