---
layout: post
title: "fluent rebasing"
date: 2017-01-09 11:02:11 -0500
comments: true
tags: [git]
---

Recently, we've adopted [rebasing](https://git-scm.com/book/en/v2/Git-Branching-Rebasing) into our git workflow. Because of this, we now enjoy clean, traceable, and roll-backable code history. Rebasing is great. However, it comes with a few issues, which I will call "rebase trolls". Rebase trolls love to hide out in long-running branches, waiting to make a mockery of your best intentions when you suggest "hey, we should rebase this branch first before merging it into master".

The aim of this post is not to convince you to rebase. No, I only intend to arm you with the necessary tools to easily smack down these rebasing trolls. Starting with some of the simpler cases and progress onto the complications that inevitably arise as specs evolve and bugs are discovered, you should ultimately feel that rebasing is (almost) as easy as straight merging.

In all of the commands below, you can always replace refs such as `master`, `head`, with any other git ref. I have used example refs of `master` and `head` when this is likely how you will usually use them.

# Basic Rebasing

There's a lot of well-writtenand concise info on rebasing in the [git book](https://git-scm.com/book/en/v2). Get to know [basic rebasing](https://git-scm.com/book/en/v2/Git-Branching-Rebasing), the [--force](https://git-scm.com/docs/git-push) flag, and [commit squashing](https://git-scm.com/book/en/v2/Git-Tools-Rewriting-History) as a baseline. In a nutshell,  `git rebase master` takes your branch and makes-believe that you started that branch on current master. But because belief is reality, it also make it so. What you get is then a simple, step-by-step, linear history of commits to `master` without complicated forks and dependencies.

[image1: basic rebase]

With [interactive rebasing](https://git-scm.com/book/en/v2/Git-Tools-Rewriting-History), you can also clean up your branch: you can combine multiple commits, re-order commits, and generally manipulate a branch. Why? To make your commits more useful when you other other developers need to look back at, or revert to, this chapter in your code's history. Away with you, commit messages of "beh"! Now each commit can fully represent a meaningful code change that can be understood at a glance.

As you become more fluent with rebasing, you gain a new perspective on your code. Instead of a bag of files, your code base also becomes a series of meaningful commits. Merging into master evolves from "shove my files into master" into "apply my feature change(s) on top of the current commit stack". Personally, I find this perspective to be enormously useful when planning how to combine mulitple long-running feture branches into a major code release.

[image2: rebase with reorder (fixup) and squash]

# Rebasing Issues

Rebasing has a learning curve. But if you commit (heh) to it, it's really not hard to get over it.

The most common issue rebasing newbies encounter is basically a really annoying and persistent merge conflict. Bad commit habits can turn merge conflicts from merely annoying to a huge pain in the ass when rebasing is involved. These are always defeatable, and also preventable. First, let's understand what's happening.

When you rebase a long series of commits, git redoes each commit sequentially, dealing with any issues one commit at a time. So on a branch with 25 new commits, a merge conflict on commit 1 if not resolved smartly can become a merge conflict in commit 2, and 3, and so on. The "undying merge conflict". Nobody wins.

For example, if you change a block of code that was moved on master, you get a merge conflict. You resolve this by moving your changed block of code to where it was moved to on master. But you changed that same block of code again in the next commit. New merge conflict.

Another common issue is the cloned commit. Rebasing a commit necessarily changes it, so if you merge a branch that contains commits that are rebased version of old commits you already have, you will get both sets of commits. This issue and some of its solutions are well described in the [git book](https://git-scm.com/book/en/v2/Git-Branching-Rebasing).

In the following sections, we will discuss (1) prevention of these issues, (2) how to deal with them if you failed to prevent them, and (3) your safety net should you get in over your head when trying to solve these issues.

# Prevention

The best offense is a good defense, so let us take our battle right to the home of the rebase trolls. Keep your branch clean. Use helpful commit messages. You may not want to spend the 2 seconds it takes to remember what you just did, but when shit hits the fan you will be very glad you did. You might even get a little boost in code strategy organiation while you're at it!

Here are some tools to help you that you might not be familiar with if you're new to rebasing.

## 1. Clean up your commits

The lowest hanging fruit here are the extra commits you make to quickly fix up a quick typo or similar: the dreaded "beh" commit (with messages like "beh" or "oops" or "fixed"). These commits do not belong in your history; get rid of them! When battling the undying merge conflict, if you're weighed down by carrying 23 "beh" commits with you, the rebase troll is going to win.

Before we go on, the following can never be stated enough times. Other developers working on your code need to all be in sync when rewrite / rebase commits. Rebase trolls are sneaky bastards: if you vanquish them from your branch they will look for any opportunity to hop onto someone else's local copy of that branch. Don't let them! If anyone else has a copy of a branch you wish to rebase, make sure they delete or [fetch and reset](#reset) their branch before they do anything else!

That said, here are some of the tools you can use to clean up your branch and diminish the rebase trolls' power.

<a name="amend" id="amend"></a>
`git commit --amend --no-edit` - immediately squash the current staged changes into the last commit (`--amend`) and use its commit message (`--no-edit`). Use this when you want to make a quick change to the last commit (that isn't yet on master or anyone else's machine)

<a name="fixup" id="fixup"></a>
`git commit --fixup $sha` - Make a new commit, but mark it as an amendment (with no message changes) to the commit specified by `$sha`. Use this is you want to modify an earlier commit but aren't prepared to actually modify that commit yet, maybe because someone else is also working on the same branch.

<a name="fixup" id="fixup"></a>
`git commit --squash $sha` - Like `--fixup`, but prompt for a new commit message when you squash the commits together.

<a name="autosquash" id="autosquash"></a>
`git rebase -i --autosquash $ref` - Do an interactive rebase, but automatically reorder and set to fixup / squash any commits that are marked to do so. Here, the `--autosquash` is only helpful if you've marked any commits as `--fixup` or `--squash` commits.

## 2. Make sensible commits

When you view your code base as a bag of files instead of a series of commits, a quick typo fix can go anywhere in your commit history. But when you take on the series-of-commits viewpoint, though, you'll quickly learn to insist that those commits be by themselves or squashed into the original commit. Otherwise you just won't feel like all is right in the world.

Why? Because rebasing, AKA manipulating commits, is difficult when the commits themselves don't actually represent any coherent set of changes. Not just because you don't know which change is where, but because commits littered with fixes to other commits introduces dependencies to those commits, and reordering or cherry picking commits becomes difficult or impossible. So commit wisely, and avoid the rebase trolls!

`git add $file1 $file2 ...` - add only specified files to the changes staged for commit. You likely already know this one, but may largely use the `git add .` form ("add everything"). Be more specific!

Need to make a quick unrelated fix in the middle of your feature branch? `git add $that_file; git commit -m 'fix that_file'`.

What if that quick fix was in the same file you were working on for another feature? Don't worry, git has you covered:

<a name="add" id="add"></a>
`git add -p` (or `--patch`) - select specific sections of code changes to stage for commit.
<br>
`git add -i` (or `--interactive`, from which you can enter `patch` mode)

Using the patch tool, you are provocatively asked for each section of code that has changed if you want to "stage this hunk?". Here, you can answer "yes" only to the hunks that are the typo fix, commit those changes (using `--fixup` if you so choose), then continue coding as if nothing had interrupted your flow. You can also use the `s` command to split a hunk into smaller sections if the quick fix you're looking to add is only a piece of the current hunk. Hunk hunk hunk. Great word.

## 3. Be aware of your environment

Visibility is key to avoiding traps, so knowing how to easily detect lurking rebase trolls can help you vanquish them. For this, you'll first want to make liberal use of `git log`. Here are a few forms of `git log` that can be helpful when preparing for battle.

<a name="log" id="log"></a>`git log --graph` - show a graphical represnetation of existing commits and their parent commits.


`git log master..head` - show only the commits that you've made on `head` that are not yet on `master`. Switch `master` and `head` around and you see only the commits that `master` has that you don't (i.e. other feature merged into master).

`git show $sha` - show the changes made by `$sha`.

<a name="cherry" id="cherry"></a>
`git cherry master head` will show you just the sha's of the commits on `head` and not `master`. Here, the second ref (`head`) is optional and defaults to `head`.

<a name="name-status" id="name-status"></a>
`git diff --name-status` - view just the file names that have been modified or added, each with a "M" or "A" to indicate which. Using the default refs essentially gives you the same as `git status`, but with `diff` you can view this form between any two git refs.

`git show $sha --name-status` - the same for a single commit using `git show`

`git log --name-status` - the same as above for `git log`

# Battle

Even after you've mastered the above, you will still have to battle the rebase trolls from time to time. When you do, here are some weapons that will help you on your journey.

## 1. Squash commits without rebasing on the latest master

If you know you're about to fight an undying merge conflict across several commits, you could squash all of these commits first to make your battle easier. However, if you've already fetched `master` from your remote, any attempt to rebase off of master enters you directly into the battle. You need:

<a name="merge-base" id="merge-base"></a>
`git merge-base master head` - Don't perform any operations, but print out the commit sha where `master` diverges from `head`. This should be the commit where you where on `master` when you created this branch. You will want to rebase off of this commit instead of master to temporarily avoid dealing with any recent changes to master.

`git rebase -i --autosquash $(git merge-base master head)` - do the above in one line, if you're using bash (the `$(...)` gets evaluated and inserted by bash before executing the rest of the command).

## 2. Better understand a merge conflict

When you are resolving a merge conflict, git's default two-sided (`<<<<<<` vs `>>>>>>`) merge conflict markers sometimes leave you without knowing what changed on `master` that you are trying to resolve. To get a better view, use

<a name="conflict" id="conflict"></a>
`git checkout --conflict=diff3 $file_with_merge_conflict` - checkout the conflicted file with an additional merge conflict marker (`|||||||`) that shows you what the original form of the code was before either branch modified it. I like this view enough to make it my default.

[image1: diff3]

`git config --global merge.conflictstyle diff3` - make the above your default.

<a name="ours-theirs" id="ours-theirs"></a>
`git checkout --ours $file` - blow away the other branch's file in favor of yours.

`git checkout --theirs $file` - blow away your own file in favor of the other branch's.

## 3. Build a new branch

Branches are transient, commits in master are forever. Sometimes the easiest way to dodge a horde of rebase trolls is simply to prepare a new branch off of master. With the right tools, this is quite trivial: you simply need to select the commits and/or patches that you want on your clean branch, no messing with the code required.

<a name="cherry-pick" id="cherry-pick"></a>
`git cherry-pick $sha` - apply the commit specified by `$sha` on top of your current head. You may want to use then when someone (including yourself) has made a commit on a separate branch that you want to incorporate into your branch without a whole merge and/or rebase dance.

<a name="apply" id="apply"></a>
`git apply $diff_file` - apply the diff contained in `$diff_file` as unstaged changes on your current head. You can easily generate such a diff using `git diff ref > $diff_file`

Maybe you're at your wit's end. You want to apply your changes in one fell swoop as a single commit, feature differentiation be damned, and move on with your life. There's a tool for that.

<a name="merge-squash" id="merge-squash"></a>
`git merge --squash $feature_branch` - the nuclear option. Pretend like you're doing a merge, but all changes are left as unstaged instead of preserving any commits or their parents. In other words, make all the necessary changes to files that you need to get your current branch into the state it would be in after a merge of `$feature_branch`. You can then add and commit as normal. This way, you can very easily avoid any rebase trolls, but still integrate your feature branch in a linear series of commits.

For example, you could use this to build a clone of your feature branch that is now ready for a simple fast-forward merge pull request:

```
[feature] $ git checkout master
[master] $ git pull
[master] $ git checkout -b feature_new
[feature_new] $ git merge --squash feature
[feature_new] $ git add .
[feature_new] $ git commit -m "My feature in one commit"
```

Of course, you can also use `git add $files` or `git add -p` to build a more granular commit history.

# Retreat!!

In any battle, it helps to know you have a safe way out. Git gives you multiple.

<a name="abort" id="abort"></a>
`git rebase --abort` - run away! This rebase has become to sticky and I want to try something else.
<a name="reset" id="reset"></a>
`git reset --hard $ref` - completely revert the state of my current branch to `$ref`.
<a name="clean" id="clean"></a>
`git clean -df` - after a reset, if you have untracked / new files or directories you also need to reset, this will get rid of them.

A common form of the retreat is `git reset --hard origin/$branch_name`. This will completely blow away any local changes you have on your branch and set your branch to the copy on origin. The end result is the same as if you deleted your local branch and checked out the remote branch. Note that you still need to `git fetch` if there are changes that were pushed up since your last `fetch`.

# Victory over the Rebase Trolls

Hopefully you have a budding comfort now with rebasing and the tools and weapons you have to vanquish the rebase trolls. As you continue on your journey, know that these trolls have no power over your code workflow and cannot stand in your way to beautiful code. Godspeed, good coder. Godspeed.

Have any other rebasing issues you come up against? Did I say something stupid? Let me know in the comments below!
