# Prior art: does something already embody this idea?

Researched 2026-11-03. Judged **only on mental model and ideology**, against concepts 1–5 in `docs/product/concept.md`. Runtime and Hermes compatibility are ignored. An earlier pass that scored candidates on Hermes compatibility was the wrong question; this file replaces it.

## Verdict
**Building this isn't redundant. No product, open or closed, combines the whole ideology.**

| | Closest to us on… |
|---|---|
| **Rakazo** (open, Apache-2.0) | Overall structure |
| **Agent Zero** (open) and **Kortix CompanyOS** (source-available) | The split: knowledge belongs to the project, behaviour to the personality |
| **Manus Projects** (closed) | Improvement loop: the only shipped product that proposes edits for you to approve. It works on the whole project, not on one routine |

## Scores
✅ = matches the concept · ◐ = partial · ❌ = absent

The numbered columns are concepts 1–5:
1. Project owns knowledge.
2. Personalities are behaviour only and read project memory.
3. Parallel threads with a cast.
4. Invite vs assign.
5. Playbook + runs + tuning.

| Product | Open? | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| Rakazo | Apache-2.0 | ✅ Space | ◐ bots also keep their own memory | ◐ group chats, but one chat per bot | ◐ cards come from anonymous subagents | ◐ instruction + triggers, history |
| Agent Zero | open, custom | ✅ | ✅ profiles | ◐ one profile per chat | ◐ subordinates | ◐ tasks; improve by editing the project |
| Kortix CompanyOS | Elastic-2.0 | ✅ company repo | ✅ | ◐ one front agent | ✅ | ◐+ skills as playbooks; agents propose changes, a person approves |
| Manus Projects | closed | ✅ | ❌ | ◐ | ❌ | ◐+ reviews finished work and proposes edits you approve |
| Open Duet | Apache-2.0 | ◐ | ❌ memory per agent | ✅ rooms with a default responder | ✅ | ◐ each run is a full conversation |
| Claude Projects + Cowork | closed | ✅ | ❌ | ◐ | ❌ | ◐ |
| ChatGPT Projects + @GPTs + Tasks | closed | ✅ | ❌ @GPTs don't use memory | ◐ | ❌ | ◐ |
| Dust (Spaces + Pods) | closed | ◐+ | ◐ | ◐ | ◐ | ◐ |
| Paperclip | MIT | ◐ | ◐ | ❌ | ✅ | ◐+ revisioned instructions |
| Multica | source-available | ◐ | ◐ | ◐ squads | ✅ | ◐ autopilots |
| LobeHub | community licence | ◐ | ❌ | ◐ orchestrator-run groups | ✅ | ◐ acceptance checks |
| SillyTavern | AGPL | ❌ | ◐ | ✅ group chats | ❌ | ❌ |

## Models of the three closest

**Rakazo**
```
Account  (models · approvals · vault)
 └─ Space "Work"              ← chats · files · Shared memory · skills · Team Computer
     ├─ Bots   (each: ONE continuous chat · instructions with history · OWN memory · computer)
     ├─ Group chats  (no @ → first bot answers; @Name; @everyone)
     ├─ Subagents    (cards: Running / Completed / Failed)
     └─ Routines     (per bot: instruction + triggers → reports in the bot's chat)
```
How it differs from us:
- Bots own memory: "each keeps its own history and memory".
- The bot, not a topic thread, is the unit of conversation.
- A routine is a prompt on a bot, with no playbook versions or tuning thread.

**Agent Zero**
```
Instance
 ├─ Global agent profiles  (Developer · Researcher · Writer)
 └─ Project                 ← instructions · files · memory · secrets · model
     ├─ Agent profiles  (role · instructions · model · tool/skill access)
     ├─ Chats           (parallel; ONE profile each)
     └─ Tasks           (scheduled; inherit project memory)
```
How it differs from us:
- No multi-persona threads.
- No invite vs assign.
- No routine object and no tuning loop.

**Kortix CompanyOS**
```
Company = one git repo   ← agents · skills ("written playbooks") · rules
 ├─ Drive       shared files + company memory
 ├─ My Kortix   the one front agent; routes work
 ├─ Agents      prompt · model · permissions · skills → propose skill changes → a person merges
 ├─ Sessions    background work, hand-offs
 └─ Triggers    schedules · webhooks · events
```
How it differs from us:
- Built for a company, with one front agent instead of a cast.
- No persona threads.
- Improvement goes through git change requests on skills, not a per-routine conversation.

## Genuinely unclaimed
1. **Memory-less personalities combined with group threads.** Some products have one half (Agent Zero, Kortix), others have the other half (Rakazo, Open Duet, Bot Mode). None has both. The rule "only the conversation you're in proposes memory writes" wasn't found anywhere.
2. **A routine as a versioned playbook with its own tuning loop:**
   - each run records which playbook version it used;
   - runs are compact reports;
   - one tuning thread per routine;
   - "Discuss this run";
   - you accept or decline proposed edits.

   Fragments exist in other products: Manus (project-level proposals), Kortix (skill change requests), Paperclip (revisions with anchored comments), Rakazo (instruction history).
3. **👍/👎 on single items in a run,** folded into the next tuning.
4. **"Make this a routine",** distilling a finished discussion into a playbook. Not found, though not fully ruled out.
5. **Invite and assign as two verbs for the same named personality in one thread.**

**Already claimed elsewhere:** project-scoped memory, host-first group chat with @all, status cards, scheduled runs with history.

## If we wanted to start from Rakazo instead
Getting from Rakazo to our concept needs four changes:
1. Bots stop owning memory and read the space's memory instead. This goes against Rakazo's stated philosophy, so a fork would drift from upstream.
2. Topic threads with a chosen cast become the main unit, instead of one chat per bot.
3. Routines get a playbook with versions recorded on each run, compact run reports, and a tuning thread.
4. Assigning work to a personality produces a task card from that personality.

## Ideas worth borrowing
- **Global Activity / Today view** of runs that need you (Rakazo, Open Duet).
- **Artifacts library** of everything the personalities produced (Rakazo).
- **Cards that don't block the conversation** for questions, approvals and "needs you" moments (Rakazo, Ekko).
- **Composer:** `@persona`, `@routine`, `/skill` (Rakazo).
- **Undo and version history** on any change made from chat (Rakazo).
- **Rule for untagged messages** in a multi-persona thread: "only tagged / one member / everyone" (Open Duet).
- **Memory-write proposals** with a journal, plus hash-checked saves (Open Duet).
- **Playbook revisions** with anchored comments (Paperclip). **Acceptance criteria** scored on every run (LobeHub).
- **Run states:** queued / running / needs_input / completed / failed / missed / skipped (Open Duet).
- **Routine features:** a test-run button, a cheaper model per routine, watch triggers (Rakazo).

## Unverified
- Manus self-updating projects (Manus's own blog and press coverage only).
- Claude Cowork tasks attaching to a project (secondary sources).
- ChatGPT project-memory semantics (sources conflict).
- Dust multi-agent @mention.
- How Kortix projects relate to its company repo.
- Whether Lindy Societies still exist.
