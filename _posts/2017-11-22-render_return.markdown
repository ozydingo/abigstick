---
layout: post
title: "RenderReturn: a controller Exception"
subtitle: "Solving the double render problem in Rails"
date: 2017-11-22 13:15:00 -0400
comments: true
tags: [Rails]
---
<small>Skip to [tl;dr](#tl-dr)</small>

<div style="padding:20px; width: 80%">
  <p style="background:red; color:white; font-weight:bold; padding: 10px">AbstractController::DoubleRenderError</p>
  <p style="color:red">Render and/or redirect were called multiple times in this action. Please note that you may only call render OR redirect, and at most once per action. Also note that neither redirect nor render terminate execution of the action, so if you want to exit an action after redirecting, you need to do something like "redirect_to(...) and return".</p>
</div>

If you've been around the block with Rails, you've probably seen this error. The error message is sufficiently explanatory: don't call `render` and/or `redirect_to` multiple times. Often this happens because you tried to extract a `redirect_to` call into some private method and failed to completely exit out of the controller action.

Here, in this message, Rails itself is suggesting violating the [Ruby Style Guide](https://github.com/bbatsov/ruby-style-guide) by suggesting `redirect_to(...) and return`. Now, I violate this aspect of the style guide myself: I will never give up construct such as `x = find_the_thing or raise (...)`. But here it's a little more sinful: it implicitly relies on the return value of `redirect_to` being truthy. The [docs](https://apidock.com/rails/ActionController/Redirecting/redirect_to) don't even specify what the return value of `redirect_to` should be. This is a bad pattern to follow.

Moreover, this doesn't even solve the nested-method problem I alluded to above:

```ruby
class MyController < ActionController::Base
  def show
    check_for_bad_stuff
    # ...
    render json: the_data
  end

  private

  def check_for_bad_stuff
    redirect_to :error_page if bad_condition?
    log "Checked the thing"
  end
end
```

`redirect_to and return` won't work here for obvious reasons: the `return` simply goes back to the controller. So you could bubble the `return` up to the `show` action: `check_for_bad_stuff and return`. But this requires different return values in `check_for_bad_stuff`. Ok, let's bite:

```ruby
def check_for_bad_stuff
  if bad_condition?
    log "Nope."
    redirect_to :error_page
    return false
  else
    log "It checks out."
    return true
  end
end
```

Except it's now it's `redirect_to(...) or return`. Fine. It all makes sense, and is easy to follow when it's the only thing you're looking at, but this simple concept of "redirect and get out of here" has already taken up for more of our attention than it deserves.

Other [similarly unconvincing blogs](https://blog.arkency.com/2014/07/4-ways-to-early-return-from-a-rails-controller/) give a short list of working but frankly similarly bad or, worse, a touch cryptic, solutions.

So here's mine.

This, to me, screams out as a use case for `raise`, coupled with [`rescue_from`](https://apidock.com/rails/ActiveSupport/Rescuable/ClassMethods/rescue_from). That is, "get out of here completely, no matter how buried down the stack you are." Ultimately, that's what you want after some of these `redirect_to`s. I'll briefly mention `throw :halt` works too, as I learned from a comment in the above linked blog, but that's not as of yet well documented Rails behavior (read: not guaranteed to work), and frankly I dislike the potential for naming conflicts with `throw`. Exceptions work perfectly well in this case.

```ruby
class ApplicationController < ActionController::Base

  rescue_from RenderReturnException, with: :render_return

  def render_return
    # Do nothing.
  end
end
```

Now,

```ruby
def check_for_bad_stuff
  if bad_condition?
    log "Nope."
    redirect_to :error_page
    raise RenderReturnException
  end
  log "It checks out."
end

```

The `RenderReturnException` will immediately halt the action, and the `rescue_from` catches (to use Java and distinctly non-Ruby terminology) that exception in a method that does nothing so that you don't get any other error handling such as Rails' standard 500 error.

There are no implicit return values to keep track of, no boolean flipping, no hidden bugs just because you extracted code into a different method. You have only a single convention added to your code toolbelt to learn: `RenderReturnException` is a safe exception to throw to stop a controller action. Which is great, because now that's a tool you can use throughout your controllers.

If you wanted to, you could make it even more explicitly named using a method called, say `halt_controller_action`, which you can call by name anywhere in your controllers:

<a id="tl-dr" name="tl-dr"></a>
```ruby
class ApplicationController < ActionController::Base

  rescue_from RenderReturnException, with: :render_return

  def render_return
    # Do nothing.
  end

  def halt_controller_action
    raise RenderReturnException
  end
end
```

Wasn't that simple?
