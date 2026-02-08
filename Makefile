build:
	npm run build

publish: build
	gsutil -m rsync -edru dist/ gs://www.abigstick.com

server:
	npm run dev
