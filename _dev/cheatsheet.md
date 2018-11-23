### Start the server
`bundle exec jekyll serve`

### Build the \_site directory
`jekyll build`

### Sync with google storage bucket
`gsutil rsync -R _site/ gs://www.bigstickcoding.com`
TODO: why is this copying everything and not just what was updated?

May be related to warning message:
> NOTE: You are performing a sequence of gsutil operations that may
run significantly faster if you instead use gsutil -m -o ... Please
see the -m section under "gsutil help options" for further information
about when gsutil -m can be advantageous.

### Install gsutil
```
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init
```

If already installed, make sure bin folder (e.g. `/Users/andrew/Code/google-cloud-sdk/bin` is in path)
