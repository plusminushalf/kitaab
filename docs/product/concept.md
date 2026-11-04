# Product concept: how the app is organized

Status: agreed direction, 2026-11-02. This is the vocabulary the whole app uses. A Hermes term only reaches the UI if it's on this page.

## In one picture

```
Server  (your Hermes, running somewhere; the app only connects to it)
 └─ Project  "Pit Wall"            ← memory · skills · files
     ├─ Personalities  (the project's cast, added from your library)
     │    Designer · Developer · X-searcher · X-poster
     │
     ├─ Threads  (where you think: parallel lines of work)
     │    ├─ "How do we find good posts?"   👤 X-searcher
     │    ├─ "Develop the app"              👤 Developer + Designer
     │    └─ "Find new leads"               👤 Lead-finder
     │
     └─ Routines  (repeat work you've handed over)
          └─ "Find sideline posts"
               ├─ Playbook       what to do, how, and what good looks like (versioned)
               ├─ Who            X-searcher
               ├─ When           every 90 min, 07:00–23:00
               └─ Runs           one report per run; open any run to talk about it,
                                 and that conversation becomes a thread
```

The same shape for a personal project:

```
Project "Healthy life"             ← memory: goals, allergies, what you like eating
 ├─ Personalities:  Nutritionist · Coach · Chef
 ├─ Threads
 │    ├─ "This week's meals"   👤 Chef + Nutritionist
 │    └─ "Marathon training"   👤 Coach
 └─ Routines
      └─ "Plan groceries", Sundays 18:00, Chef
```

## Concepts

### Server
- The Hermes install the app connects to, usually another machine reached over SSH.
- The app never installs or updates Hermes.
- **Over SSH it runs its own private backend, the way the official Hermes app does** (decided 2026-11-04). It starts `hermes serve --isolated` on the server, bound to loopback, with a session token it mints. It reaches that backend through an SSH tunnel and reuses it on every launch. No login is needed, because SSH access is the credential.
- Without SSH it can use an existing dashboard URL, signing in through the browser if that dashboard requires it.
- v1 supports one server. The data model should still allow more later.

### Project
- The top-level container: one area of your life or work, such as "Pit Wall" or "Healthy life".
- **It owns the knowledge:** memory, skills, files.
- Everything inside a project shares that knowledge. Project facts never leak into other projects. Only personality craft and your preferences travel between projects.

### Personality
- A named character: Designer, Coach, X-poster…
- **Personalities live in your library and you add them to projects,** like a freelancer working for several clients. The project supplies the facts and the personality supplies the skill.
- **It owns behaviour:**
  - identity: personality, tone, role, opinions;
  - **craft notes:** how to do this job well, learned from your feedback, carried to every project;
  - its own tools and skills;
  - its **lens**: which project sections it reads first.
- **It never keeps private facts about a project.** Project facts go in the project.

### Thread
- One conversation, one line of work. You run several in parallel.
- **Every thread has at least one personality.**
  - The first one is the **host** and answers by default.
  - If you don't pick one, the host is the project's general assistant.
- **You can add personalities to a thread at any time.** A thread with several personalities works like a group chat:
  - A message with no @mention → the host answers.
  - `@Designer …` → that personality answers.
  - `@all …` → every personality in the thread answers, each as its own message.
- **There are two ways to involve a personality:**
  - **Invite:** it joins the thread and talks with you.
  - **Assign:** it goes off, does a piece of work, and reports back as a **task card** in the thread, with a status of working / needs you / done.

### Routine
- Repeat work on a schedule. A routine is **not** a thread and not a one-off task.
- **Playbook:** the instructions document. It records which version each run used.
- **Who:** the personality that runs it.
- **When:** the schedule.
- **Runs:** one compact report per run, listed on the routine. A run starts as a report, not a thread.
- **Talking about a run turns it into a thread.** Open any run and reply to it. That conversation becomes a thread you can come back to and keep talking in. Each run you discuss gets its own thread.
- **Where routines live:** a project has a **Routines** section. Click it to see the routines, then click a routine to see all its runs. Routine results never show up in a project-wide feed (decided 2026-11-03).

## Memory

### Four layers
```
You                   ← your taste & preferences, follow you everywhere ("no purple")
 ├─ Personality       ← CRAFT: how to do this job well; portable across projects
 └─ Project           ← FACTS, DECISIONS, STANDARDS: the company wiki
      ├─ General          what it is, goals, people, decisions
      ├─ Design standards ← stewarded by Designer, readable by all
      ├─ Eng standards    ← stewarded by Developer, readable by all
      └─ …
          └─ Thread / task ← scratch notes, thrown away when done
```

### The test
**If this personality were replaced tomorrow, should the knowledge stay?**
- **It stays → the project.** For example, "Pit Wall headings are sentence case".
- **It leaves with the personality → craft notes.** For example, "Designer, you're too wordy".
- **It's about you everywhere → your preferences.**

### Stewards
- Project memory is split into **discipline sections**.
- A personality **stewards** its section: it reads that section first and proposes changes to it. Everyone can read every section.
- One shared section can't contradict itself, the way private per-agent memories can.

### Skills, tools and accounts
Definitions:
- **Memory = what it knows** (facts).
- **Skill = how to do something:** a written procedure, opened only when a task needs it.
- **Tool = what it can physically do:** search, generate images, post.

They split by the same test:

```
Personality  X-poster
 ├─ Craft skills    write-punchy-post · structure-a-thread   ← travel with it
 └─ Tools allowed   web search · image gen · post to X

Project  Pit Wall
 ├─ Project skills  pit-wall-voice-on-x · accounts-to-never-reply-to   ← stay with the project
 ├─ Connections     Pit Wall's X account, Drive…   ← the project's accounts
 └─ Routines        playbook = a project skill that runs on a schedule
```

- **Craft skills** belong to the personality.
- **Project skills** belong to the project. Any personality working there can use them, and the steward proposes changes.
- **Accounts** belong to the project. A personality is *allowed* to use a tool; the project decides *which account* it uses.
- **At work,** a personality sees the names of its craft skills plus the project's skills, and opens only the ones the task needs.

### How personalities behave differently on shared memory
- An agent carries nothing between turns. Each time a personality speaks, its context is assembled fresh from a recipe:
  1. identity;
  2. craft notes;
  3. tools, its craft skills, and the project's skills;
  4. project memory, through its lens;
  5. your preferences;
  6. the thread so far.
- **Same model, different recipe → different behaviour.**
- Project memory is the bookshelf. The personality is who reads it and what they reach for.

## The routine loop

```
 Thread                      Routine  (Routines section → routine → its runs)
"How do we find posts?"
   │  "make this a routine"
   └──────────────▶  Playbook v1 ──▶ Run ──▶ Run ──▶ Run
                        ▲                     │ open the run, reply to it
                        │                     ▼
                        │              Run thread
                        │              "These 2 were great, this one was off-topic,
                        │               stop including retweets"
                        │                     │  (a real thread: come back and keep talking)
                        └── proposed edit ◀───┘
                            (you see the change, tap Accept)
                            → Playbook v2, the next runs use it
```

1. **A routine is born from a thread.** Once you've worked something out, "make this a routine" drafts the playbook from the conversation. Then you pick who runs it and when.
2. **Runs produce reports.** You find them under Routines → the routine → its list of runs, not in a project-wide feed. You get notified when a run finds something worth seeing, or when it fails.
3. **Reply to a run and it becomes a thread.** The run stays at the top as context. The thread is a normal thread, so you can return to it later and keep going.
4. **Improvements are proposed edits to the playbook.** You see exactly what changes and accept or decline. The routine never changes its own playbook without your approval.
5. **Optional quick feedback:** 👍/👎 on single items in a run, folded in the next time you discuss a run.

## Rules
- **Threads are for thinking. Routines are for repeat work.** Personalities are the cast for both.
- **Facts belong to the project. Craft and behaviour belong to the personality. Taste belongs to you.**
- **Personalities answer you, not each other** (v1). No personality-to-personality chatter unless you ask for it.
- **Playbook changes always go through you.**

## Decided defaults (revisit if they chafe)
- **Default host:** the project's general assistant when you don't pick a personality.
- **Personalities live in your library** and are added to projects (decided 2026-11-03).
- **Memory writes are proposals:**
  - Project facts are proposed by the conversation you're in, into the right discipline section.
  - Craft notes come from your feedback about how a personality works.

## Open questions
- **Run threads in the sidebar:** does a run's thread also appear in the project's Threads list, or only under its run in the Routines section?
- **Proposed memory writes:** does every one need your approval, or can low-stakes ones be saved automatically and shown so you can undo them?
- **Not in v1:** messaging channels (Telegram, …), personalities talking to each other, and multiple servers.
