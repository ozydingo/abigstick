Start the server
`bundle exec jekyll serve`

Build the \_site directory
`jekyll build`

Sync with google storage bucket
`gsutil rsync -R _site/ gs://www.bigstickcoding.com`
