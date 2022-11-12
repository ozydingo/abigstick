build:
	JEKYLL_ENV=production bundle exec jekyll build

publish: build
	gsutil -m rsync -edru _site/ gs://www.abigstick.com

server:
	bundle exec jekyll serve
