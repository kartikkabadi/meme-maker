# CRITIQUE-V3-MOTION — Final Motion & Animation Review (launch-v3)

**Candidate:** `launch-v3.mp4` (release v0.3.1) — 1080x1080, 30fps, H.264, ~27.0s video + ~27.05s AAC audio.
**Method:** frame-by-frame inspection at 1fps (27 frames) plus 4fps higher-resolution frames (108 frames) for transitions, count-up, and the final fade. Source (`media/launch/src/index.tsx`) consulted read-only to confirm intent.

## Verdict: READY FOR LAUNCH

**No blockers, no majors.**

## Scene-by-scene findings

1. **Hook (0–3s)** — "BUT IT CAN'T SHITPOST." punchline holds frames 0–17 by design (`HOOK_TYPE_START = 18`), then the typewriter fills in the setup line. Reads as an intentional beat, not a freeze-frame defect. Legible throughout.
2. **Title card (~4–6s)** — "MEME-MAKER / deterministic memes for agents" enters cleanly; no jitter or clipped text.
3. **JSON typewriter (~6–10s)** — Typewriter progresses smoothly from partial to complete JSON spec, then the rendered Drake meme appears. Cause-and-effect ("ONE JSON SPEC IN. PIXELS OUT.") is clear.
4. **Four surfaces (~10–13s)** — Title enters first, then bullets (CLI / MCP / HTTP / WEB UI) and the meme card stagger in. Good build order, no popping.
5. **Deterministic (~13–16s)** — "SAME SPEC. SAME PIXELS." with bullets; scene visibly fades down before the count-up, so the cut is not abrupt.
6. **Count-up (~16–20s)** — Counter animates 577 → 609 and the meme card label matches "609 TEMPLATES". Count-up lands and holds; no stutter observed.
7. **Rendered grid (~20–23s)** — 3x2 meme grid under "RENDERED BY MEME-MAKER ITSELF" is stable and legible with subtle motion; no dead air.
8. **CTA + final fade (~23–27s)** — Install command, repo URL, and tagline enter in sequence and hold long enough to read. A proper fade-to-dark begins around ~26.6s and completes by end of video (confirmed at 4fps: frames 00:26.36 → 00:26.60 → 00:26.86 show a clean progressive fade). No hard cut to black, no trailing freeze.

## Focus checklist

- **Pacing / scene durations:** 8 scenes across 27s; each scene gets ~3–4s, enough to read all copy without dragging.
- **Transitions:** clean fades/builds between all scenes; no flash frames or blank frames found in the 4fps pass.
- **Ken Burns / drift:** subtle drift present on card scenes; nothing distracting, no jitter.
- **Typewriter:** hook and JSON typewriters both progress smoothly and complete before their scenes exit.
- **Count-up:** 577 → 609 animates and settles correctly.
- **Freeze frames:** none unintentional; the only long holds (hook punchline, CTA) are deliberate reading beats.
- **Final fade:** present and clean (~0.5s at end).
- **Music sync:** audio duration matches video (~27.05s vs ~27.0s), so no trailing audio or early cutoff. Beat-level sync was not independently measured; nothing in the frames suggests a sync defect.

## Issues

- **[MINOR]** The final fade is short (~0.5s) and starts late, so the CTA text is still fading as the video ends. Fix (optional): start the fade ~10 frames earlier or lengthen it to ~0.8s so the fade completes with 2–3 fully dark frames before the end.

No other issues found. Ship it.
