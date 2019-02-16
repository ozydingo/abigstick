# Big Stick Coding

This is a blog about coding things I've encountered. Its scope includes small code modules I made & like to philosophical musings and rants about development.

This blog is built by Jekyll and hosted as a static site in a Google Cloud bucket (www.bigstickcoding.com), pointed to by Google Domains & DNS (www.bigstickcoding.com).

## How to build

Install [jeckyll](https://jekyllrb.com/):  
`gem install bundler jekyll`

_Note_: on OS default installs of Ruby in early 2019, there is an SSL issue that prevents `gem` from working. Installing a new ruby may be all you need to fix this:
* Follow the instructions at [rvm.io](https://rvm.io/) to install rvm
* Install the latest ruby `rvm install ruby-head`
* Confirm `rvm list` shows that you are using the latest ruby, or `ruby --version` does the same.

### Start the server (for local testing)
`bundle exec jekyll serve`

### Build with production features (e.g. Disque)
`JEKYLL_ENV=production jekyll build`

### Build (into the the \_site directory)
`jekyll build`

### Sync with google storage bucket
`gsutil -m rsync -edru _site/ gs://www.bigstickcoding.com`

### Install gsutil
```
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init
```

If already installed, make sure bin folder (e.g. `/Users/andrew/Code/google-cloud-sdk/bin` is in path)
