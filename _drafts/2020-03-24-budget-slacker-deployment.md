Just for now, let's quickly look at the project's organization.

```
.
├── functions
│   ├── add_expense [...]
│   ├── get_totals [...]
│   ├── handle_pubsub_message [...]
│   ├── handle_slack_command [...]
│   ├── handle_slack_interaction [...]
│   ├── request_oauth [...]
│   ├── setup [...]
│   ├── spreadsheets [...]
│   ├── store_oauth [...]
│   └── teams
└── templates
    ├── budget-slacker.yml
    ├── budget_slacker_function.jinja
    └── pubsub_topic.jinja
```

Simple enough. Our deployment templates are in a `templates` folder, and the functions we need are in `functions`. Each of these functions will use Node.js.

## Deployment Manager

Let's take a break from Node.js function code and look at how to actually deploy all of these functions together. In brief, a Deployment Manager configuration or template specifies resources such as functions, pubsub topcis, and IAM roles.

Here's a small snippet of our Deployment Manager configuration to get us started.

```yml
- name: slack-pubsub
  type: pubsub_topic.jinja
- name: handle-slack-command
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/handle_slack_command
    public: true
    environmentVariables:
      pubsub_topic: $(ref.slack-pubsub.name)
```

In this small section, we're creating the first two resources we talked about: the function that handles the Slack command request and the PubSub topic that this function publishes to.

Both resources reference a template that we have additional files for: `pubsub_topic.jinja` and `budget_slacker_function.jinja`. Taking them at face value for now, there are only three configurations we're providing here:

* The code location for `handle-slack-command` -- this refers to a location inside the [Google Source Repository](https://cloud.google.com/source-repositories) that we're pushing this code to.
* Specifying that this function is public, which will mean we allow unauthenticated invocation. We want this to be the case *only* for those functions that need to be called externalls, such as Slack handlers and Oauth redirects.
* The encironment variable `pubsub_topic`, which takes the value of the deeployed name of the pubsub topic. This allows the function to reference the pubsub topic without hardcoding the name or making any assumptions about how Deploymnet Manager names its deployed resources.

Diving into `budget_slacker_function.jinja`, we use a bunch of reasonable function defaults (Node.js runtime, 256 MB memory, 60 s timeout, `main` as the entry point function name), some simple configurations such as the function's base name, code location, and environment variables, and primary have our own logic for

* Public vs authenticated invocation
* HTTPS vs PubSub trigger

{% raw %}
```yml
{% set location = 'us-east1' %}
{% set name = env['deployment'] + '-' + env['name'] %}

{% set environmentVariables = properties['environmentVariables'] or {} %}
{% set function_name = name + "-function" %}
{% set parent = 'projects/' +  env['project'] + "/locations/" + location %}
{% set policy_name = name + "-policy" %}
{% set trigger = properties['trigger'] or {'httpsTrigger': {}} %}
{% set sourceRepoUrl = 'https://source.developers.google.com/projects/budget-slacker/repos/budget-slacker/moveable-aliases/master/paths/' + properties['codeLocation'] %}

{% set _ = environmentVariables.update({'deployTimestamp': env['current_time']|string}) %}
{% set _ = environmentVariables.update({'functionName': function_name}) %}

resources:
  - name: {{ function_name }}
    type: gcp-types/cloudfunctions-v1:projects.locations.functions
    properties:
      function: {{ function_name }}
      sourceRepository:
        url: {{ sourceRepoUrl }}
      parent: {{ parent }}
      timeout: 60s
      runtime: nodejs8
      availableMemoryMb: 256
      entryPoint: main
      {% if 'httpsTrigger' in trigger %}
      httpsTrigger: {}
      {% elif 'eventTrigger' in trigger %}
      eventTrigger:
        resource: $(ref.{{ trigger['eventTrigger'] }}.name)
        eventType: providers/cloud.pubsub/eventTypes/topic.publish
      {% endif %}
      environmentVariables:
        {{ environmentVariables }}
  - name: {{ name }}-policy
    action: gcp-types/cloudfunctions-v1:cloudfunctions.projects.locations.functions.setIamPolicy
    properties:
      resource: $(ref.{{ function_name }}.name)
      policy:
        bindings:
          - members:
            {% if properties['public'] %}
            - allUsers
            {% else %}
            - serviceAccount:{{ env['project'] }}@appspot.gserviceaccount.com
            {% endif %}
            role: "roles/cloudfunctions.invoker"

{% if 'httpsTrigger' in trigger %}
outputs:
  - name: url
    value: $(ref.{{ function_name }}.httpsTrigger.url)
{% endif %}
```
{% endraw %}

Let's briefly walk through our custom logic here.

* We name the function `{{ name }}-policy`. E.g. `handle-slack-command-function`.
* The `trigger` jinja variable can be passed in from the configuration, or it defaults to `{'httpsTrigger': {}}`, which means a regular https trigger with an auto-generated URL. The only other option it supports is `eventTrigger`, which we'll see when we view the configuration for `handle_pubsub_message`.
* We create an IAM policy to attach to the function called `{{ name }}-policy`, e.g. `handle-slack-command-policy`. This policy is attached to the function as its resources and has two possible values for its member binding:
  * `allUsers` for public functions. This is a special  user designation in Google Cloud that allows unauthenticated users to invoke the function.
  * `serviceAccount:{{ env['project'] }}@appspot.gserviceaccount.com`. This construction represents the default [service account](https://cloud.google.com/iam/docs/service-accounts) that other Google Cloud Functions will be using. That is, this member binding allows other Google Cloud functions in the same project to invoke this function.
* Lastly, if the function is an https trigger, we declare an output named `url` to allow the configuration using this template to print this URL out.

The `pubsub_topic.jinja` is relatively much more straightforward. It's just a PubSub topic with a name.

{% raw %}
```yml
resources:
  - name: {{ env['name'] }}
    type: gcp-types/pubsub-v1:projects.topics
    properties:
      topic: {{ env['deployment'] }}-{{ env['name'] }}

```
{% endraw %}

So, with that, let's just see the full configuration.

```yml
imports:
- path: budget_slacker_function.jinja
- path: pubsub_topic.jinja
resources:
- name: handle-slack-interaction
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/handle_slack_interaction
    public: true
- name: slack-pubsub
  type: pubsub_topic.jinja
- name: handle-slack-command
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/handle_slack_command
    public: true
    environmentVariables:
      pubsub_topic: $(ref.slack-pubsub.name)
- name: handle-pubsub-message
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/handle_pubsub_message
    trigger:
      eventTrigger: slack-pubsub
    environmentVariables:
      addExpenseUrl: $(ref.add-expense.url)
      appCredentialsSecret: projects/526411321629/secrets/sheets-api-credentials/versions/2
      teamsUrl: $(ref.teams.url)
      getTotalsUrl: $(ref.get-totals.url)
      requestOauthUrl: $(ref.request-oauth.url)
      slackTokenSecret: projects/526411321629/secrets/slack-verification-token/versions/1
- name: teams
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/teams
- name: get-totals
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/get_totals
- name: add-expense
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/add_expense
- name: request-oauth
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/request_oauth
    public: true
    environmentVariables:
      appCredentialsSecret: projects/526411321629/secrets/sheets-api-credentials/versions/2
      storeOauthUrl: $(ref.store-oauth.url)
- name: setup
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/setup
    environmentVariables:
      spreadsheetsUrl: $(ref.spreadsheets.url)
      teamsUrl: $(ref.teams.url)
- name: spreadsheets
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/spreadsheets
- name: store-oauth
  type: budget_slacker_function.jinja
  properties:
    codeLocation: app/functions/store_oauth
    public: true
    environmentVariables:
      appCredentialsSecret: projects/526411321629/secrets/sheets-api-credentials/versions/2
      setupUrl: $(ref.setup.url)
      teamsUrl: $(ref.teams.url)
outputs:
- name: handle-slack-command-url
  value: $(ref.handle-slack-command.url)
- name: handle-slack-interaction-url
  value: $(ref.handle-slack-interaction.url)
```

Look, digest that in your own time, but at a high level this configuration is a PubSub topic and a bunch of functions (with IAM roles) as defined by `budget_slacker_function.jinja`. Each function has settings for public vs authenticated, https or pubsub trigger, code location, and any environment variables that the function will need (such as other function URLs, secrets names, or the name of the PubSub topic).
