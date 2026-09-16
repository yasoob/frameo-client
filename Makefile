.PHONY: frontend build test release run

frontend:
	cd web && npm ci && npm run build

build: frontend
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o dist/frameo-local ./cmd/frameo

test: frontend
	go test -race ./...

release: frontend
	sh scripts/release.sh

run: build
	./dist/frameo-local
