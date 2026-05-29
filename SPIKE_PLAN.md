# Spike: Does code-graph context actually beat grep/embeddings?

**Purpose.** Before you commit months of full-time work to a code-graph engine, prove the wedge exists at the magnitude you believe. This spike is **1.5 days max**. If it fails, you save 6 months and ~$0 in real cost.

**The question.** *"On real coding tasks, does Claude Code with a graphify-backed MCP server use 5×+ fewer tokens than vanilla Claude Code, while producing equal-or-better output?"*

If yes → the wedge is real, build the engine.
If no → the wedge is too small. Either pivot the thesis, find a different niche, or stop.

---

## Pass / fail criteria (decide BEFORE running, so you can't move the goalposts)

| Result | Verdict | Action |
|---|---|---|
| Graph arm uses **≥5×** fewer tokens AND quality ≥ baseline on **all 5** tasks | **Hard pass** | Build the engine. Use the data as launch material. |
| Graph arm uses **3–5×** fewer tokens AND quality ≥ baseline on **≥4/5** | **Soft pass** | Build, but narrower wedge messaging. "2–5× cheaper on architectural tasks" not "5× cheaper everywhere." |
| Graph arm uses **<3×** fewer tokens OR quality drops on **≥2** tasks | **Soft fail** | Wedge is too small for the marketing claim. Either find a sharper niche (which task type does win?) or stop. |
| Graph arm uses **similar** tokens OR quality drops badly | **Hard fail** | Thesis is wrong as stated. Don't build the engine. |

---

## Setup (~2 hours, day 0)

### 1. Install graphify and confirm it works on your machine
```bash
# Per graphify's README — use their install path
# After install, verify on a small repo:
cd /tmp && git clone https://github.com/colinhacks/zod.git
cd zod && graphify .
# Inspect graph.html, GRAPH_REPORT.md — does it look reasonable? Are nodes meaningful?
```

If graph quality on a real TS project looks broken/sparse, **stop here**. The spike is invalid because Arm B is broken. Either fix graphify first or pick a language where graphify works well (Python/JS often have better tree-sitter coverage than newer langs).

### 2. Wire graphify's MCP server into a dedicated Claude Code profile
Set `CLAUDE_CONFIG_DIR` to a fresh dir so Arm A and Arm B don't contaminate each other's session logs (agent-tab reads from there).

```bash
mkdir -p ~/.claude-spike-baseline
mkdir -p ~/.claude-spike-graph
# Copy auth from your real profile into both:
cp ~/.claude/.credentials.json ~/.claude-spike-baseline/
cp ~/.claude/.credentials.json ~/.claude-spike-graph/
# In ~/.claude-spike-graph/, add graphify to mcpServers in the config:
#   { "mcpServers": { "graphify": { "command": "graphify", "args": ["serve"] } } }
# Leave ~/.claude-spike-baseline/ vanilla.
```

Now `CLAUDE_CONFIG_DIR=~/.claude-spike-baseline claude` runs vanilla; `CLAUDE_CONFIG_DIR=~/.claude-spike-graph claude` runs with the graph.

### 3. agent-tab gives you the measurements for free
For each run, after Claude Code exits:
```bash
CLAUDE_CONFIG_DIR=~/.claude-spike-baseline agent-tab status
CLAUDE_CONFIG_DIR=~/.claude-spike-graph agent-tab status
```
Record both. The session window numbers are what you care about per-task.

---

## Codebase selection

Pick ONE primary. Optionally do a stretch goal on a second after the first 5 tasks. Criteria: real, well-tested, large enough that grep is expensive, idiomatic, and your target audience would recognize the name.

| Codebase | Lang | LOC | Why | Why not |
|---|---|---|---|---|
| **trpc/trpc** | TS | ~30k | Indie hackers know it, monorepo with clear modules, tree-sitter-TS is great | Smallish; might not stress grep enough |
| **prisma/prisma** | TS+Rust | ~250k | Big enough that grep hurts; popular | Mixed-language complicates graphify |
| **vercel/next.js** | TS | ~500k | Massive; indie hackers will care about results | Risk of graphify being slow/incomplete on a repo this big |
| **microsoft/TypeScript** | TS | ~600k | The ultimate stress test for grep | Compiler code is dense; quality judgments harder |
| **fastapi/fastapi** | Python | ~50k | Indie hackers' favorite Python framework; clean | Python's GIL means simpler call graphs — graph wedge might be smaller |
| **astral-sh/ruff** | Rust | ~150k | Modern Rust, well-tested, tree-sitter-Rust solid | Indie-hacker recognition lower than TS choices |

**My pick for primary: `trpc/trpc`.** Reasoning: clean codebase, indie-hacker brand recognition, manageable for a 1-day spike, and big enough that file-grep is non-trivial. **Secondary (if time permits): `vercel/next.js`** to test scaling.

---

## The 5 tasks (pre-selected, no cherry-picking)

Pick all 5 BEFORE you run anything. If graph loses on task 3 don't drop task 3. Every task is in the dataset.

The tasks are designed to span the spectrum where graph theoretically should win → where it shouldn't matter much.

### Task 1 — Find-all-callers (graph's home turf)
**Prompt:** *"List every function in this repo that ultimately calls `parseRouter`. For each, give the file and line. Don't include test files. Don't include the function itself."*

- **Why:** Pure structural query. Grep finds substring matches (many false positives); graph traverses the call chain (exact). Expected: graph 10×+ cheaper.
- **Success criteria:** The list is correct. Verify by manually inspecting 3 random entries.

### Task 2 — Cross-file rename (medium structural)
**Prompt:** *"Rename the type `Procedure` to `RouteProcedure` everywhere in `packages/server/src/`. Update all usages, including in type parameters, generics, and re-exports. Don't change anything in tests yet. Then list every file you touched."*

- **Why:** Graph knows symbols; grep matches strings (would also match `procedure` in comments, in unrelated `MyProcedure` types, etc.). Expected: graph 3–5× cheaper.
- **Success criteria:** `pnpm typecheck` (or repo's equivalent) still passes. No false positives in non-`Procedure` identifiers.

### Task 3 — Architectural Q&A (graph's other home turf)
**Prompt:** *"Trace the request flow from an HTTP request hitting the tRPC server to the resolver function being invoked. Name every layer in order. Describe each in one sentence. Don't paste code — explain the flow."*

- **Why:** Multi-hop traversal across modules. Grep agent reads many files; graph agent traverses edges. Expected: graph 5×+ cheaper.
- **Success criteria:** Manual review — does the trace match how tRPC actually works? Score 1–5 on accuracy.

### Task 4 — Real bug fix from the issue tracker
**Prompt:** *Pick a recent CLOSED bug-fix PR from the repo. Use the issue text as the prompt, hide the PR's diff.* Example: *"Issue: \<paste verbatim\>. Find the root cause, fix it, and add a regression test."*

- **Why:** Most realistic real-world task. Tests the whole agent loop. Closer to a tie expected — both arms have to find AND fix.
- **Success criteria:** Final diff passes the repo's tests AND fixes the issue (judged by comparing to the merged PR's behavioral outcome, not the exact code).

### Task 5 — Feature add (the hardest)
**Prompt:** *"Add a new option `silent: boolean` to the [pick a specific factory function in the repo]. When true, suppress all console warnings produced by that function. Default false. Update the type, the implementation, and add one test."*

- **Why:** Touches code, types, tests; agent must understand surrounding code. Probably the closest result.
- **Success criteria:** Tests pass; option works as documented; doesn't break existing tests.

---

## Per-task measurement protocol

For each task, do EXACTLY this:

```
1. cd /tmp/spike-trpc                          # clean checkout each task
2. git checkout main && git reset --hard HEAD  # fresh state
3. agent-tab status                            # record "before" number, both profiles
4. # === ARM A: BASELINE ===
   CLAUDE_CONFIG_DIR=~/.claude-spike-baseline claude
   # Paste the exact task prompt
   # When Claude finishes, exit Claude
   # Run any verification (typecheck/tests)
   # Capture diff: git diff > /tmp/spike-results/task-N-baseline.diff
   # Capture tokens: agent-tab status (subtract the "before" number)
   git reset --hard HEAD
5. # === ARM B: GRAPH ===
   CLAUDE_CONFIG_DIR=~/.claude-spike-graph claude
   # Paste the SAME task prompt (verbatim)
   # When Claude finishes, exit Claude
   # Run the same verification
   # Capture diff: git diff > /tmp/spike-results/task-N-graph.diff
   # Capture tokens: agent-tab status (subtract the "before" number)
   git reset --hard HEAD
6. Score both arms on the success criteria above
7. Record in the result sheet (template below)
```

---

## Honesty controls (read these before you start)

- **Identical prompts.** If you reword in Arm B to take advantage of graph tools, you've contaminated the experiment.
- **Same model.** Same Sonnet version on both arms. Don't switch.
- **Single trial unless results are close.** If Arm B is 10× cheaper, one trial is enough. If it's 1.8×, do 3 trials per arm and average.
- **Quality ties favor the BASELINE.** If you're not sure which result is better, score the baseline as winning. This biases the spike against the thesis, which is what you want — a thesis that survives a hostile test is real.
- **No retroactive task adjustment.** All 5 tasks count, even the ones you don't like.
- **You are biased.** You want this to work. Counterweight: have a friend or a second AI judge the quality scores blind (don't tell them which diff came from which arm).

---

## Result sheet template

For each task, record into a file `RESULTS.md`:

```markdown
## Task N — <title>
| Metric | Baseline | Graph | Ratio |
|---|---|---|---|
| Input tokens | | | |
| Output tokens | | | |
| Cache read | | | |
| Cost USD | | | |
| Wall time (sec) | | | |
| Files touched | | | |
| Verification (pass/fail) | | | |
| Correctness (1-5) | | | |
| Completeness (1-5) | | | |
| Idiomaticness (1-5) | | | |
| Side effects (-1 to +1) | | | |

**Notes:**
- Where did each arm go off the rails?
- Did graph try to use the MCP tools? (If no, that's a finding — agents don't auto-use them, prompt engineering needed.)
- Surprises?
```

---

## Day-of timing budget

| Block | Hours |
|---|---|
| Setup (install, MCP wiring, profile copy, smoke test on zod) | 2 |
| Pick 5 tasks (read the repo, find a real bug PR, draft prompts) | 1 |
| Run 5 tasks × ~50 min (both arms + scoring) | 4 |
| Write RESULTS.md | 1 |
| Honest write-up: what worked, what didn't, decision | 1 |
| **Total** | **9 hours** |

That fits in a long day or a comfortable day-and-a-half.

---

## What to do with the result

### If it passes (hard or soft)
1. Write a 1-page summary with the numbers + 2-3 representative diffs side-by-side.
2. Post it. HN "Show HN: I tested a code-graph MCP against vanilla Claude Code — here's what I found." This is your launch wedge BEFORE you've built anything.
3. THEN start building the engine. The post tells you if anyone cares before you spend the months.

### If it fails
1. **Don't blame graphify** unless you can show it's a graphify bug. The honest interpretation is "the wedge isn't there at the magnitude needed."
2. Look at WHICH tasks graph won on, even if average didn't pass. If it won by 10× on architectural Q&A but tied on bug fixes, your product isn't "general agent" — it's "code archaeology tool." Different product, possibly better.
3. If no task showed a clear win → stop the project. Find something else.

---

## One thing I want to flag before you start

Day 0 install of graphify might surface that graphify isn't production-ready for the codebase you picked (indexing slow, graph sparse, MCP server flaky). That doesn't kill the spike — it tells you that *if you build this*, the FIRST work is making the indexer better, not the agent integration. Note it; don't fix it; keep moving on the spike.

---

## When you're done

Send me:
1. RESULTS.md (the table for all 5 tasks)
2. Your verdict (pass / soft pass / soft fail / hard fail)
3. The two most surprising findings

I'll help interpret and decide the next step.
