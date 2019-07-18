---
layout: post
title: "The method_missing anti-pattern"
description: "How to abuse a really cool feature of Ruby"
date: 2019-06-02 04:34:00 -0400
comments: true
tags: [Ruby, Rails]
---

```ruby
class BrazilianTime < ActiveSupport::TimeWithZone
  # You're note late unless you're 5 hours late
  def late?(event_time)
    self > event_time + 5.hours
  end
end
```

Rubyists, myself included, tend to love the [Principle of Least Surprise](https://en.wikipedia.org/wiki/Principle_of_least_astonishment).

Let me show you a surprise.

```ruby
tt = Time.zone.now
tt.class
# => ActiveSupport::TimeWithZone
tt.class.superclass
# => Object
tt.class.ancestors.include?(Time)
# => false
tt.is_a?(Time)
# => true
```
