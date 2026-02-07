---
title: "Composition over Inheritance"
description: "A re-exploration of what this phrase actually means"
date: 2018-11-23 07:30:00 -0400
tags: [Ruby, OOP]
---

"Prefer composition over inheritance", they say. It runs in some OOPS circles, including the Ruby community.

Ok, I'll admit it -- the meaning of this one escaped me, even tricked me, for some time. I once thought I understood and wholeheartedly agreed with, only to discover my interpretation was dead wrong. I find many blogs either miss the point, like I did, or don't dive in deep enough to explain it to someone who is still grasping the concept.

So I want to dig into to this in a way that would have corrected my erroneous interpretation. And I'm particularly inspired to so do having recently encountered a grotesque example of the violation of this philosophy that caused much struggle for me and my team.

## Inheritance: Subclassing and Mixins

You likely know what inheritance is. One flavor of inheritance is subclassing, a cornerstone of  [OOP](https://en.wikipedia.org/wiki/Object-oriented_programming). The derived class inherits all the behaviors of the superclass, but allows you to override methods and add new behaviors. If X is a subclass of Y, it should fit the pattern "X is_a Y".

What I didn't get was that `include`ing modules (mixins) is _also_ inheritance. I thought, and many who agreed, that using modules instead of subclasses as much as possible was the key to "composition" over "inheritance". You "composed" your class of several behavior-defining modules, and this afforded you more flexibility and reusability of these module'd behaviors. Too much subclassing didn't really fit the `is_a` model, and module inclusion was the correct way.

This perspective was valuable. I've encountered to many incorrect applications of subclassing that were better solved with module inclusion. But regarding "composition over inheritance", I was dead wrong.

## Composition

Discovering the true meaning of composition, I was confused. I disagreed. New classes for every little chunk of grouped behaviors? It seemed clunky and indirect over the elegance of module inheritance. In many use cases it is.

Instead of class A including module B, class A should have an instance/member variable of a kind of class B. So A can't do `A#awesome_method`, but instead asks `@b`, it's instance of a `B`, to do it: `@b = B.new; @b.awesome_method`.

What compositions asks is to make your class dumb. Make it dumb and have it create or call completely different classes that actually know how to do the behaviors you want.

Capitalize `@name`? Use an instance of a `Capitalizer` class.

Compute the mean of `@data_vector`? Ask the `StatsComputer` class.

Where does it end? Should I even have any methods in my class at all or just a list of member class instances?

Turtles, all the way down. Suddenly my designs were exploding with classes (giving me all the parts of Java I didn't like with none of what I did). Is this truly what the Ruby community wants from me?

Of course, the key lies in using the right tool for the design at hand. And I'm here to show by way of example where using `include` is definitely the wrong tool.

## When inheritance is bad

Why is OOP good in the first place? To me one of the main benefits is elegantly organizing and labeling what would otherwise be a behemoth, monolithic collection of code with no obvious division of responsibility.

Too much inheritance leads you right back into this dark, dark place. Your class that includes all these modules is now that monolith. To an extreme, you end up with an app where you've wrapped a non-OOP monolith in a class and called it OOP. For cycles spent inside your class, member variables are basically global variables. Lipstick on one ugly pig. (Disclaimer: I think pigs are quite cute.)

The use case that brought me here was almost this bad. We had a class designed to allow developers at a large software company to easily create the infrastructure they needed for a new project. For example, git repositories, continuous integration setup, virtual hosts to deploy code to, and so on. Cool!

Each of the distinct sets of operations, like methods to create and manage git repos, methods to create and manager continuous integration, methods to spin up and manage hosts, were contained in a module that could be included. To use this tool, you'd subclass this class, include the relevant modules you needed, and override any data or methods to fit your desired configuration.

For this example, I'll pretend all of these modules are included in the parent class. In reality, the parent class would check if these modules were included and perform behaviors based on that. But that makes the code a lot longer and doesn't add much to the example, so I'll simplify.

Skim, if you will, the following. A simplified example where we have five such groups of behaviors included:

```ruby
class InfrastructureBuilder
  include DeploymentHostManager
  include RepoCreator
  include BranchCreator
  include CIAgent
  include GemSync

  def initialize(project_name, owner)
    ...
  end

  def setup
    repositories.each do |repo|
      git_repo = find_or_create_repo(repo)
      branches(repo).each {|branch| create_branch(git_repo, branch)}
      setup_ci(repo)
    end
  end

  def sync
    create_server(repositories)
  end

  def deploy
    hosts.each do |host|
      deploy_branch(host, main_branch)
    end
  end
end
```

Then in your subclass, you can customize simply be only overriding what you need:

```ruby
class MyInfrastructureBuilder < InfrastructureBuilder
  def sync
    register_auth_certificates
    super
  end
end
```

Well isn't that neat. But once you start customizing anything beyond the dead simple, it becomes obvious why this smacks you in the face with effecitve non-OOP, a monolith with global variables and methods. You might override two methods that talk to each other through a common caller but that relationship is hidden behind an opaque curtain of the subclass. Its source code is the only effective documentation given the number of permutations of overrides.

Maybe you need to override `main_branch`. It probably comes from `BranchCreator`, but this is a guess and your guesses will get worse as the complexity of this class increases. Maybe the `RepoCreator` reads this value, and maybe it doesn't.

If you override `deploy`, you need to understand the current code and the details of all of the methods it calls in order to achieve your slight modification of behavior. Who calls `deploy` anyway? Does it need the return value of `hosts`? Is `deploy_branch` only needed by `deploy` or is it used by some other method, either in the same or a different module?

These are the kinds of confusions and frustrations that this design invites. Yes, it could all be well documented, but the nature of this design makes it easy for that documentation to get out of sync. And show of hands who's ever worked in an organization that stayed 100% on top of documentation?

In bullet points, the problems are:

  1. Discoverability is poor. You can't read through all of the modules and make sense of the methods you are meant to override for a given feature vs those that you should leave alone.
  2. It's difficult and dangerous to customize. You need to override these methods completely to modify behavior, and doing so safely assumes that you understand the operation and intent of all its dependencies.
  3. The code is a minefield of naming conflicts. The master class now has hundreds of methods. Godspeed if you decide to quickly write a helper method or two in the same class, as the design invites you to do.

So let's see this with composition.

  ```ruby
  class InfrastructureBuilder
    def initialize(config_file)
      @repositories = read_reop_config(config_file)
      @hosts = read_host_configs(config_file)

      @host_manager = create_DeploymentHostManager(...)
      @repo_creator = create_RepoCreator(...)
      @branch_creator = create_BranchCreator(...)
      @ci_agent = create_CIAgent(...)
      @syncer = create_GemSync(...)
    end

    def create_DeploymentHostManager(...)
      DeploymentHostManager.new(...)
    end

    # ... and so on with these creator methods.
    # you could also tool it using dependency injection instead.

    def setup
      @repositories.each do |repo|
        @repo_creator.create(repo)
        @branch_creator.create(repo) unless @branch_creator.nil?
        @ci_agent.perform(repo) unless @ci_agent.nil?
      end
    end

    def sync
      @syncer.start unless @syncer.nil?
    end

    def deploy
      @hosts.each do |host|
        @host_manager.deploy(host)
      end
    end
  end
```

It's really not that different.

But now each of the concerns are managed by a proper class. A self-contained unit that can be independently tested, debugged, and overridden. If you override anything you know the scope if its effects.

Customization become hierarchical. Learning about each component is self-contained. Its interactions with methods in the master are limited. You don't need to worry about inadvertently breaking some unrelated component by overriding something because the design focuses everything toward single-responsibility.

Instead of a flat list of methods, you get classes. Object oriented programming as it's meant to be.

Composition.
