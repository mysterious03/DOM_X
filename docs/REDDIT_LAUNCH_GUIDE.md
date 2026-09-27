# 🚀 Reddit & Community Launch Kit for DOMPulse

> **Why your previous posts got banned or removed:**
> Reddit has some of the strictest spam detection and automated moderation filters on the internet. Subreddits like r/webdev, r/programming, and r/LocalLLaMA use automated bots (AutoModerator) and spam filters that instantly delete posts for specific technical reasons—not because of your code!

---

## 🛑 The 6 Reasons Your Posts Got Removed (And How to Fix Them)

| # | Why It Got Banned | The Fix |
|---|---|---|
| 1 | **Posted as a "Link Post" to GitHub** | **NEVER submit a direct Link post.** Reddit's sitewide spam filter treats bare GitHub links from new/low-activity accounts as bot spam. Always use a **Text Post (Post)** with native video/GIF attached and link at the bottom. |
| 2 | **Low Account Karma / Account Age** | Many tech subreddits silently remove posts from accounts with `< 50 comment karma` or accounts `< 15-30 days old`. *(See below for the 15-minute karma priming strategy).* |
| 3 | **Violated Subreddit Rules (e.g., r/webdev)** | r/webdev **bans all self-promotional posts** except on **Showoff Saturday** with the `[Showoff Saturday]` tag in the title. Posting on any other day results in instant removal. |
| 4 | **Trigger Words in Title** | Words like *"Star my repo"*, *"Check out my GitHub"*, *"Please upvote"*, *"Follow me"* trigger AutoMod regexes. Reddit hates marketing speak. Use **engineering problem-first titles**. |
| 5 | **Cross-posting too fast** | Submitting the same link or text across 3+ subreddits within 15 minutes triggers Reddit's sitewide spam shadowban. Space out posts by at least 24-48 hours per subreddit. |
| 6 | **No Native Media Attached** | Reddit posts with native video/GIFs get 8x more visibility in user feeds and are viewed by moderators as high-effort content rather than link farming. |

---

## ⚡ 15-Minute Karma Priming (Do this BEFORE posting)

If your Reddit account has low karma:
1. Go to **r/AskReddit** or **r/technology**.
2. Filter by **Top > Past Hour** or **New**.
3. Write 4-5 thoughtful, helpful, or funny comments on rising posts.
4. You will easily gain 30–100 comment karma in a couple of hours.
5. Your account is now whitelisted past 99% of AutoMod spam filters.

---

## 🎯 Target Subreddits & Rules Cheat-Sheet

| Subreddit | Audience | Best Timing (EST / UTC) | Strict Rules |
|---|---|---|---|
| **r/LocalLLaMA** (400k+ members) | AI engineers, agent builders, local model hackers | Tuesday / Wednesday 8:00 AM EST (12:00 UTC) | Must be open-source / local. Loves latency & token cost comparisons. Text post only. |
| **r/autonomousagents** | Multi-agent, LangChain, Browser-Use devs | Any weekday morning | Tag with discussion/project flair. Very receptive to browser automation solutions. |
| **r/webdev** (2.3M members) | Web developers, frontend engineers | **Saturday ONLY** (Showoff Saturday) | Must start title with `[Showoff Saturday]`. Flair: `Showoff Saturday`. |
| **r/javascript** | JS/TS core enthusiasts | Thursday 9:00 AM EST | Focus on MutationObserver, debounce batching, and DOM reflow avoidance. |
| **Hacker News (news.ycombinator.com)** | Founders, senior engineers, YC community | Tuesday - Thursday 7:30 AM EST | Title must strictly start with `Show HN:`. No marketing adjectives. |

---

## 📋 Ready-to-Post Reddit Templates (Copy & Paste)

### 🥇 TEMPLATE 1: For r/LocalLLaMA & r/autonomousagents
*Target audience: AI engineers who know the pain of VLM screenshot costs.*

**Title:**
```
I got tired of browser agents burning $50 in VLM calls just to see if a button changed, so I built an open-source 15ms DOM perception layer [MIT]
```

**Post Type:** `Post` (Text)  
**Media:** Attach a 10-15s screen recording / GIF of the HUD or testbench showing bounding boxes.  
**Flair:** `Project` or `Tools / Software`

**Body:**
```markdown
Hey everyone,

If you've built autonomous browser agents using Playwright, Browser-Use, or Puppeteer, you know the biggest bottleneck:

Agents usually take a 4K screenshot every 500ms, ship 5MB over the wire to GPT-4o / Claude 3.5 Sonnet / Gemini, and ask: *"Did anything happen?"*

This causes:
- 2,500ms – 4,000ms latency per step
- Hundreds of dollars in vision token costs
- Complete blindness to invisible semantic states (like `aria-expanded="false"`, `disabled`, or DOM changes scrolled out of view)

I built **DOMPulse**, a lightweight local Chrome Extension (Manifest V3) that eliminates the screenshot loop.

### How it works:
1. **Adaptive Debounce Buffer:** Uses an 80ms trailing debounce with a 200ms `maxWait` hard boundary to prevent React/Vue re-render storms from freezing the agent.
2. **4-Tier Semantic Filter:** Discards 96.2% of raw DOM noise (micro CSS flips, framework attributes like `data-v-*`, and script/style tags).
3. **Late Geometry Calculation:** Defers `getBoundingClientRect()` until after noise rejection so we never trigger unnecessary browser layout reflows.
4. **Structured JSON Output:** Emits clean JSON events with exact screen bounding box coordinates `[x, y, w, h]` and semantic change tags in ~15.4ms.

### Benchmarks (under heavy e-commerce workload + 100 cosmetic mutations):
- Raw mutations: 104
- Cosmetic noise filtered: 100 (96.2% noise eliminated)
- Surviving events: 4
- Critical event recall: 100%
- Processing latency: **15.38 ms** (vs 3,000ms+ for VLM screenshots)

### Python / Playwright Integration:
You can load the extension directly in your Playwright persistent context and listen to the event stream:
```python
page.expose_binding("onDOMPulseEvent", lambda source, event: handle_dom_change(event))
page.evaluate("""
    window.addEventListener('dompulse:event', (e) => {
        window.onDOMPulseEvent(e.detail);
    });
""")
```

It's 100% local, MIT licensed, has 30/30 unit & benchmark tests passing, and requires zero external APIs.

GitHub: https://github.com/mysterious03/DOMPULSE

Would love your thoughts, feedback, and edge-cases on tricky SPAs!
```

---

### 🥈 TEMPLATE 2: For r/webdev (Saturday Only!)
*Note: Only post this on a SATURDAY!*

**Title:**
```
[Showoff Saturday] DOMPulse – We reduced browser DOM mutation noise by 96% to make web agents 100x faster
```

**Post Type:** `Post` (Text)  
**Flair:** `Showoff Saturday`

**Body:**
```markdown
Happy Saturday everyone!

Over the last few weeks I've been experimenting with browser automation and AI agents. One thing that struck me was how noisy modern web apps are under the hood: clicking a single button in a React or Angular app can trigger 100+ MutationObserver events (ripple classes, SVG icon redraws, framework tracking attributes).

I built **DOMPulse**, an open-source Manifest V3 Chrome Extension and perception layer designed to filter that noise down to meaningful state changes in real time.

### Tech highlights:
- **Noise Filter:** Filters out cosmetic framework noise (`data-v-*`, transient `A -> B -> A` state flips, CSS hover classes).
- **Zero Reflow Penalty:** Defers bounding box calculations (`getBoundingClientRect`) to avoid layout thrashing during animation frames.
- **Event Importance Scoring (1-5):** Deterministically rates changes so agents react instantly to modals, dialogs, or disabled buttons while ignoring background DOM churn.
- **Client-Side SPA Navigation:** Monitors `pushState`, `popstate`, and `hashchange` to keep state in sync across dynamic apps.

Average processing latency is **15.4ms**, and it runs completely offline in the browser.

Live HUD & Repo: https://github.com/mysterious03/DOMPULSE

Any feedback on the MutationObserver architecture or edge-case handling is super welcome!
```

---

### 🥉 TEMPLATE 3: For Hacker News (Show HN)
*Hacker News loves concise, humble, technical posts without buzzwords.*

**Submission URL:** https://news.ycombinator.com/submit  
**Title:**
```
Show HN: DOMPulse – 15ms DOM perception layer for AI browser agents
```
**URL field:** `https://github.com/mysterious03/DOMPULSE`  
*(Or submit as text if you want to include context)*

**First Comment (post this immediately after submitting):**
```markdown
Hi HN,

Current browser agents (Playwright, Browser-Use, etc.) rely heavily on continuous 4K screenshot loops fed into Vision-Language Models to detect if UI state changed after an action. This introduces 2-4 seconds of round-trip latency and high API costs for every step.

DOMPulse is a lightweight local Manifest V3 Chrome Extension that monitors DOM mutations in real time and emits structured JSON change events with screen bounding boxes in ~15ms:

1. 80ms trailing debounce with a 200ms maxWait ceiling to handle React/Vue re-rendering storms.
2. 4-tier semantic noise filter eliminating ~96% of cosmetic churn (e.g. data-v-* attributes, SVG ripples, transient DOM transitions).
3. Late geometry extraction to avoid layout thrashing.
4. Deterministic importance scoring (1–5) for critical state flips (aria-expanded, disabled, modals).

The repo includes a live testbench, 30 Vitest benchmark tests, and Python/Playwright integration snippets.

Code is MIT: https://github.com/mysterious03/DOMPULSE

Feedback on the MutationObserver pipeline and edge cases is appreciated.
```

---

### 🐦 BONUS: Twitter / X Tech Thread

**Tweet 1 (Hook + Video):**
> AI browser agents spend $30-$50 per run taking screenshots just to ask: "Did the button change?"
> 
> We fixed this. 
> 
> Introducing DOMPulse: a 15ms local perception layer that eliminates 96% DOM noise and gives exact click coordinates without VLM screenshots 🧵👇
> [Attach video/GIF of HUD]

**Tweet 2:**
> When you click a button in modern React/Vue apps, the browser fires 100+ micro mutations.
> 
> Taking a 4K screenshot for every state flip adds 3,000ms latency and burns tokens.
> 
> DOMPulse uses an 80ms adaptive debounce + 4-tier semantic filter to distill 104 mutations down to 4 meaningful events in 15.4ms.

**Tweet 3:**
> Surviving events include exact screen bounding boxes [x, y, w, h], aria states, and importance scores (1-5).
> 
> Agents can click directly on the target coordinates without ever calling a vision model.

**Tweet 4:**
> 100% Local (0 Cloud APIs)
> Manifest V3 Extension
> Python & Playwright ready
> MIT Licensed
> 
> Star on GitHub: https://github.com/mysterious03/DOMPULSE
