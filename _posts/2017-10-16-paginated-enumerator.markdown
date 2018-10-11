---
layout: post
title: "Fun With Enumerators: enumerating over paginated content"
date: 2017-10-16 00:00:00 -0400
comments: true
tags: [Ruby]
---

---
## Summary

Seamlessly enumerate over paged content (such as an api index route) using a simple `.each` call. Pages are only fetched as needed, and all other chainable enumerators also work as expected.

For example:
```ruby
data = PaginatedEnumerator.new{|page| JSON.load(`curl api.foo.com?page=#{page}`)}
data.each{|thing| puts thing}
```

---
<small>Skip to [tl;dr](#tl-dr)</small>

## Enumerators and Enumerables

`Enumerator`s and the `Enumerable` module in Ruby are very richly featured and, in my opinion, among its most appealing design choices (although I do confess some love for Python's iterators, as well). Using these features effectively often makes up a good deal of low hanging fruit in code refactoring code for performance and readbility (simultaneously!), and so is very worth some exploration! Let's quickly start at the beginning.

`Enumerable` is simply a module specifying a collection of methods such as `each`, `map`, `select`, and so on. Classes that include `Enumerable` are what you probably think of when you think of enumerating, such as `Array` and `Hash`.

`Enumerator`s are object you are actually dealing with every time you call these methods. Ruby abstracts away its details very neatly in the `Enumerable` methods signatures such that you're rarely dealing with them directly. But `Enumerator` are what allow you to chain these methods such as in `data.map.with_index{|obj, ii| "#{ii}: #{obj}`, and how we can get the awesomeness of [lazy enumerators](http://patshaughnessy.net/2013/4/3/ruby-2-0-works-hard-so-you-can-be-lazy).

We're going to get a little practice leveraging `Enumerator`s by implementing an `Enumerable` class that abstracts away the details of fetching bufferred or paginated content. The use case that inspired building this class, for example, was a routine to loop through and selectively pull media content from various hosts' API calls that listed albums. For some of the APIs, but not others, these albums were returned in pages. We wanted to build a common structure where the logic for looping over the content itself did not have to be made aware of the pagination; it could just `data.each` and the details of how to get the `next` item was up to the object passed to it.

## PaginatedEnumerator

We're going to build a class called `PaginatedEnumerator`. Despite [some advice to the contrary](http://blog.arkency.com/2014/01/ruby-to-enum-for-enumerator/), we're going to `include Enumerable` here, because this is intended to be a very general use class and I want the users of this class to be able to call `select`, `map`, `reduce`, `find`, and, yes, even `minimax` if they so choose.

The user will then be able to use it like so:

```ruby
data = PaginatedEnumerator.new{...}
data.each{|item| do_something_with(item)}
```

And that's it! The key is the block provided to `new` -- this needs to tell our `PaginatedEnumerator` it how to fetch the next page. With that, any calls to `each`, or `minimax`, or any other `Enumerable` method can ignore the details of pagination. So let's flesh out what that block should look like.

## Fetching the page

A good first spec for how the user can tell us how to fetch a page is with a block that takes a page number as an argument. So this might look like

```ruby
data = PaginatedEnumerator.new{|page| fetch_page(page)}
```

where `fetch_page(page)` makes a web request with the appropriate parameters. A key detail here is that `fetch_page` will only be called only when needed, so a loop won't immediatly try to make 100 API calls, or however many are neede to reach the end of the data.

Speaking of the end of the data, let's add one more detail to our spec: if there is no data left, the block should return an empty `Array`. That way we know when we're done. With Ruby's `Enumerator`s, the pattern we will follow is to `raise StopIteration` when we observe this condition.

## Sketching out the class

In pseudocode, the class should look roughly like
```ruby
class PaginatedEnumerator
  include Enumerable

  def initialize(&pager)
    # store the block, which specifies how to get the next page
    @pager = pager
    @buffer = []
  end

  def each
    loop do
      @buffer += fetch_page(current_page) if need_page?
      raise StopIteration if @buffer.empty?
      yield @buffer.shift
    end
  end
end
```

Actually, this isn't too far from the final code. This is why I love Ruby.

In the `initialize` method, we store the block (called `&pager`), which should look like what we said above: it takes a page number as an argument, and returns the data at that page. We also initialize a `@buffer`, which stores the values we've already fetched from the API.

Ok, but how do we actually implement `fetch_page`? This is actually quite easy with Ruby `Block`s and `Proc`s:

```ruby
def fetch_page(page)
  @pager.call(page)
end
```

So let's keep an index, `@page`, that we'll initialize to `0` by default, but allow the user to override.

```ruby
  def initialize(page: 0, &pager)
    @pager = pager
    @page = page
    @buffer = []
  end
```

We've define `each`, as `Enumerable`s are wont to do. Given the `Enumerable` module, we now get, for free, all of our favorite `Enumerble` methods! Well, except for one detail: we need to return an `Enumerator` if there is no block given to `each`. This is as simple as

```ruby
def each
  return enum_for(:each) if !block_given?
  ...
end
```

Returning the `Enumerator` provided by `enum_for` allows us to call this method without a block and chain enumerators, pass them around without evaluation, or create lazy enumerators.

## Do the loop

The `loop` and `yield` pattern is the heart of enumeration in Ruby. Given a block, such as that in `data.each{|x| puts x}`, the `yeild` is what executes the code in that block: `yield(value)` calls `puts x` with `value` in the place of `x`.

But we need a stop condition. As mentioned above, our requirement is that your block given to `PaginatedEnumerator.new` returns [] when there are no values left. It's nice to formalize this requirement to isolate our class from the innumerable (see what I did there?) ways the inner code may behave when its out of data (`nil`, `[]`, `false`, `raise`...). Thus we leave that knowledge up to the caller. We simply respond to this condition of no more data (`[]`) by raising `StopIteration`, which is an `Enumerator`'s signal to stop looping.

So that builds out out `each` method like so:

```ruby
def each
  return enum_for(:each) if !block_given?

  loop do
    # Fetch a page if we're out of data
    @buffer += fetch_page if page_needed?
    raise StopIteration, "No more data" if @buffer.empty?
    yield @stored_values.shift
  end
end
```

Putting this all together, we have a nice, concise, and very useful class!:

<a name="tl-dr" id="tl-dr"></a>

```ruby
class PaginatedEnumerator
  include Enumerable

  def initialize(page: 0, &blk)
    raise ArgumentError, "Block required to define how to fetch new records" if blk.nil?
    raise ArgumentError, "Block needs to take exactly one argument (current page)" if blk.arity != 1

    @pager = blk
    @page = page
    @buffer = []
  end

  def each
    return enum_for(:each) unless block_given?

    loop do
      if @buffer.empty?
        @buffer += fetch_page(@page)
        raise StopIteration if @buffer.empty?
        @page += 1
      end
      yield @buffer.shift
    end
  end

  private

  def fetch_page(page)
    @pager.call(page)
  end
end
```

## In action

Let's use it!

```
2.3.3 > ee = PaginatedEnumerator.new do|page|
2.3.3 >   puts ">>> FETCHING page #{page}"
2.3.3 >   if page > 3
2.3.3 >     puts ">>> Out of data!"
2.3.3 >     []
2.3.3 >   else
2.3.3 >     # Dummy content
2.3.3 >     ('a'..'c').map{|char| "#{page}:#{char}"}
2.3.3 >   end
2.3.3 > end
# => #<PaginatedEnumerator:0x007fa6b5a90f48 @pager=#<Proc:0x007fa6b5a90ef8@(irb):30>, @page=0, @buffer=[]>
2.3.3 > ee.each.with_index{|x, ii| puts "#{ii}: Next value: #{x}"}

### output
>>> FETCHING page 0
0: Next value: 0:a
1: Next value: 0:b
2: Next value: 0:c
>>> FETCHING page 1
3: Next value: 1:a
4: Next value: 1:b
5: Next value: 1:c
>>> FETCHING page 2
6: Next value: 2:a
7: Next value: 2:b
8: Next value: 2:c
>>> FETCHING page 3
9: Next value: 3:a
10: Next value: 3:b
11: Next value: 3:c
>>> FETCHING page 4
>>> Out of data!
```

Notice how "FETCHING page n" is not printed until that page is reached; we are able to interact with each page's data before fetching the next page. We can also easily use this with Ruby's lazy enumerators:

```ruby
2.3.3 > ee.lazy.select{|x| x.last == "c"}.first(2)
>>> FETCHING page 0
>>> FETCHING page 1
 => ["0:c", "1:c"]
```

Note that `select` use on a non-lazy enumerator forces evaluation of the entire Array, and this behavior is no different with our enumerator:

```ruby
2.3.3 > ee.select{|x| x.last == "c"}.first(2)
>>> FETCHING page 0
>>> FETCHING page 1
>>> FETCHING page 2
>>> FETCHING page 3
>>> FETCHING page 4
>>> Out of data!
 => ["0:c", "1:c"]
```


Because of the magic of `lazy`, only the pages needed to select the first 2 results that matched the select condition were ever called. Wonderful!
