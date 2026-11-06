# Gummy Shark V2 — Physics Integrity and Unified Interaction

Implementation date: Friday, Nov 6, 2026, about 4:45 PM ET.

Baseline physics tree: `06e93ac29bb65fc4490b8710dbdcdaf32e3f7526` (`Make landings inelastic and pulls a real stretch`). That is the tree audited in `docs/GUMMY_SHARK_V1_AUDIT.md`. This branch starts from `d2dfd68`, which adds that audit and does not change the shark.

The V1 audit is unchanged.

## Root causes

The V1 solver integrated, resolved constraints, then **wrote the grabbed particle to the pointer**. That write happened after the stretch lock, so a boundary edge could reach 7.1×, 7.6×, and 9.7× rest while `maxStretch` was 1.62.

Two extra choices made the same body feel like two toys:

- Pull mode multiplied neighborhood velocity toward zero on release and aimed the shape target at a fixed screen seat (`homeX`, `homeY`).
- Drop mode kept velocity and, on a wall, the pin and the wall disagreed until the outline split.

A second, quieter cause showed up once the pin was removed. About 1,200 near-boundary links were hard-limited. That set does not have a nearby pose inside `[minStretch, maxStretch]` once the candy is flat: Gauss–Seidel walks to a compromise with hundreds of edges still outside the band (measured peak about 1.7–1.8, and a rest-pose blend used as a last resort inverted short edges down to about 0.002). The outline ring by itself, 108 edges of degree 2, does converge.

Recovery had the same seat problem in miniature. Shape goals were lifted as a rigid pose, but any particle already near the floor was forbidden to rise, and a fallback blend clamped each particle onto the floor independently. A crumpled shark could not stand back up, because the crumpled particles were the ones on the floor.

## What changed

One grab. The Pull / Drop buttons are gone. The hint is “grab the shark”.

The pointer is a rate-limited step (`grabSpeed` 11 world units per second), applied **before** the constraint passes. Part of the step (`carry` 0.34) is a rigid translation of every particle, so a sustained drag still moves the body after the local edges are at their lock. The rest is a gaussian stretch around the pinch. Nothing writes a particle to the pointer after the last projection.

Release does not delete velocity. Every particle is blended toward the capped pointer velocity, with a larger share at the pinch, then clamped to `maxSpeed` (9). Shape recovery is always around the current center of mass. `comKY` stays 0, so the floor holds the shark up, not a hidden seat.

Distance corrections move the previous position by the same delta, so a constraint fix does not invent speed proportional to `1/dt`. The frame is integrated at a fixed substep `h = 1/180` with an accumulator, capped at 8 substeps.

The hard stretch lock is the outline ring, plus near-boundary bars whose rest length is at least 0.09. Shorter links stay soft springs. After the substeps, a seal projects the locked edges exactly. If that projection pinches the outline into a self-intersection, the body is eased toward the resting silhouette **around the current center**, then sealed again. That is the folding approximation: a 2D outline is not allowed to tie a knot. A real crease that crosses itself is unfolded. Bends that do not cross are kept.

A resize ends the grab and translates the body into the new room. It does not keep the old world-space pinch. On viewports narrower than 760px the shark length is `min(width - 176, height * 0.46, width * 0.62)`, which leaves about 88px past the snout.

The floor is still inelastic (`restitution` 0, `floorPush` 0.95). Only particles that are actually the underside in the rest pose stay planted. A fin that has fallen onto the floor can still get up.

`?debug` exposes `window.__gummy` (metrics, screen positions, reset). It is not part of the normal page.

## Tests

`src/sim/softBody.test.ts` now covers the fourteen scenarios from the brief: slow snout, slow tail, dorsal, extreme pointer jump, fast flick, both walls, a bend, repeated grabs, resize during a grab, recovery, 30/60/120 Hz, and mesh validity (finite positions, edge band, area, and a simple outline).

Tolerances, from the solver rather than from a wish:

- **Edge band.** `maxStretch` is 1.62 and `minStretch` is 0.72. Tests allow 0.04 past either side. A full-speed wall throw published a worst edge of about 1.65. On a typical 0.06 rest edge that is about 0.002 world units. V1’s same edges were 7–10×.
- **Settled area.** After a hard interaction the seated shark holds about 0.62 of its free area or more. Tests require above 0.60 and below 1.20, and `crossed === false`. The V1 fold was 0.16, with a crossed outline. In-flight grabs must stay above 0.62. A wall impact may flatten to about 0.47 for a few frames; the in-flight floor there is 0.42, and the settled check is what requires the shark to return.
- **Frame rate.** A 0.4s snout pull at 1/30, 1/60, and 1/120 stays within 0.1 world units or 15% on the snout, and within 0.08 on area. Mean speed no longer scales like `1/dt`.

`npm test`: 20 passed (17 soft-body, 3 math). `npm run typecheck`, `npm run lint`, and `npm run build` pass. The production bundle is about 34.5 kB (13.2 kB gzipped).

## Before / after

| Case | V1 | V2 |
| --- | --- | --- |
| Worst structural edge after the pointer | 7.1× to 9.7× rest | At the 1.62 lock, or about 1.65 on a hard wall (0.04 tolerance) |
| Fold area | 0.16 of rest, notch stayed | During the bend, above 0.62 and not self-intersecting. Browser fold released to area 1.00 |
| Dorsal pull area | up to 2.37 | Browser dorsal pull 1.03, edges under the lock. Test requires under 1.35 and a settled shark |
| Release | Pull mode deleted the flick | Fast release moves the center by more than 0.35 in 15 frames, then settles, outline simple |
| 375×667 snout | about 49px from the right edge, pull did nothing | 88px from the right edge. A pull took area from 1.00 to 0.87 with edges at the lock |
| Resize while holding | Body crushed into a corner | Grab ends, body is translated inside. Area 0.97, outline not crossed |

## Browser pass

Chrome on this machine, page `http://127.0.0.1:5173/?debug`, driven with the Chrome DevTools protocol (mouse and synthesized touch). Layout viewports: 1440×900, 1280×720, 390×844, 375×667. Captures are under `/opt/cursor/artifacts/` (`v2-*.png`, `v2-browser.json`).

Measured on 1440×900, Friday, Nov 6, 2026, about 4:44 PM ET:

- Idle seated area 0.89, edges at the lock, outline not crossed. The shark is one piece on the floor.
- Slow snout drag: area 0.84 at release, 0.88 a second later, max edge 1.62, not crossed.
- Slow tail drag: area 0.83, max edge 1.62, not crossed. The V1 tail drag was the zigzag. This one stays a shark.
- Dorsal lift: area 1.03, max edge 1.28, the fin comes off the floor.
- Fast flick: area 0.96 while moving, 0.96 after it settles, one piece.
- Snout dragged toward the tail: area 0.78, not crossed, then area 1.00 after release.
- Lift and drop: area 1.08 while held, 0.93 after landing, belly on the floor, shark intact.
- 390×844 and 375×667: snout right gap and tail left gap both about 88px. Pulls change the body and leave a simple outline.
- Resize during a grab (1440 to 800×600): grab released, area 0.97, not crossed.
- Synthesized touch on the snout: the body responds (speed about 4), edges stay at the lock, the outline does not cross. The belly can dent during the pull. After release the shark is recognizable, with a wavy underside. That dent is the remaining visual limit.

Frame rate in this Chrome, 1440×900, debug overlay on (the overlay draws the particles): **62 frames in 1016 ms, about 61 fps**. The V1 audit measured about 61 fps on its machine. This sample is the same class of result. It is not a claim about a phone.

Real-device touch was not run. The touch path above is Chrome’s synthesized touch, not a handset.

The screen recording `v2-gummy-shark-gestures.mp4` is the same session in the desktop window. The window chrome crops the bottom of a 900px layout, so the shark is often only partly in that video. The CDP screenshots are the full layout.

## Requirements matrix

| V1 failure | V2 |
| --- | --- |
| User must choose Pull or Drop | PASS |
| Pointer overwrites particles after the solver; edges 7–10× | PASS |
| Fold collapses area to 0.16 and leaves a notch | PASS for the collapse and for a crossed outline. A fast pull can still dent the belly; see limitations |
| Dorsal pull inflates area to 2.37 | PASS |
| Wall throw splits the shark | PASS in the deterministic left and right wall throws (edges, area, simple outline, aspect). A separate full-speed browser wall throw was not filmed; the browser flick stayed one piece |
| Pull deletes release velocity and returns to a seat | PASS |
| 375×667 pull does nothing because the snout is at the edge | PASS for reach (88px) and for a pull that deforms the body. The audit’s “15% wider” figure was not remeasured on screen |
| Resize during a grab piles the body into a corner | PASS |
| Constraint speed scales with frame rate | PASS |
| Inelastic floor squash | PASS |
| Real-device touch | UNVERIFIED |

## Remaining limitations

A 2D outline cannot fold over itself and stay a simple polygon. When a bend would cross, V2 unfolds it toward the rest silhouette around the current center. The shark stays recognizable. It does not tie a knot, and a very hard pull can still push a dent into the belly before that repair catches a true crossing.

The seated shark rests under its free area (often 0.85–0.95, and about 0.62 after a violent interaction) because gravity and the 0.72 compression lock are allowed to shorten it. That is the gummy sitting down, not a return to a screen seat.

A wall impact can leave one locked edge about 0.04 past 1.62 for a frame. The seal is exact projection on a cycle; the last published frame of a violent hit can be one correction short.

## Performance

Same solver budget as a browser toy: 3 fixed substeps per 60 Hz frame, 4 soft iterations, 16 exact passes on the locked set, then a short seal. No new particle count (338). Measured about 61 fps at 1440×900 in this Chrome with the debug overlay on. V1 was about 61 fps. The bundle grew by about 1 kB gzipped.

## Recommended next phase

The belly dent on a fast pull is the visible gap. A local corner repair that can tell a dent from a floor squash, without pulling the whole silhouette back while the hand is still moving, would make hard grabs look softer. That is a small change to the outline pass, not a new simulator. Real-device touch is still unmeasured.
