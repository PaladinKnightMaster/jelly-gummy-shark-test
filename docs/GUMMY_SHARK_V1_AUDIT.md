# Gummy Shark V1 — Independent Quality Audit

Audit date: Friday, Nov 6, 2026, about 4:00 PM ET.

Audited tree: `06e93ac29bb65fc4490b8710dbdcdaf32e3f7526` (`Make landings inelastic and pulls a real stretch`).

That tree is the tree of `origin/main` at merge `af0ca3ee6bb7e0888d9234842e091fe202ac67e7` (merge of pull request #1). Local `main` was still the benchmark baseline until `origin/main` was fetched. The audit ran against the merged tree. Production source was not modified.

This audit does not treat earlier session notes as evidence. Every number below was measured again in this pass, or it is marked as a reading of the source.

## 1. Executive verdict

V1 is a recognizable, pleasant candy illustration with one convincing physical moment: a drop onto the floor shortens the shark and the belly stays down, then the silhouette eases back. A moderate pull of the snout or the tail also lengthens that end and returns.

It is not yet dense, soft candy that a person can naturally grab, bend, fold, squash, flick, and throw as one material.

The two modes are the main reason. Pull deletes release momentum and springs the pose back to a fixed seat. Drop carries the body like a soft prop and, on a hard wall hit, tears the outline into pieces that do not recover. A kinematic pin can stretch a boundary edge to about 7–10 times its rest length even though the solver’s stated stretch cap is 1.62. Pulling the dorsal fin in the headless solver inflated the outline area to 2.37 times rest. Dragging the snout toward the tail collapsed the outline area to 0.16 of rest. In the browser, a throw into the right wall split the shark, and 0.7 seconds later it was still a crumpled shape on the floor.

Weighted score from the evidence in this pass: **5.5 / 10**. Real-device touch was only partly exercised. See the scorecard.

The right V2 move is to keep this mesh, this renderer, and this floor idea, and to stop letting the grab bypass the strain limit. A rewrite is not required.

## 2. Architecture findings

### Stack, as installed

No runtime dependencies. Locked dev dependencies from `npm ls --depth=0` in this environment:

| Package | Declared | Installed |
| --- | --- | --- |
| vite | ^6.0.6 | 6.4.5 |
| vitest | ^3.0.5 | 3.2.7 |
| typescript | ^5.6.3 | 5.9.3 |
| typescript-eslint | ^8.18.0 | 8.72.1 |
| eslint | ^9.16.0 | 9.39.5 |

The app is a Vite + TypeScript module with no React. `index.html` holds a canvas, two mode buttons, and a hint. `src/main.ts` owns the pointer loop and `requestAnimationFrame`. `src/sim/softBody.ts` is the solver. `src/sim/geometry.ts` builds the mesh. `src/sim/math2.ts` is polar rotation and curve resampling. `src/render/drawShark.ts` is Canvas 2D. Tunables live in `src/params.ts`.

Build: `tsc --noEmit && vite build`. Dev server: `vite --host 127.0.0.1 --port 5173`.

### What the body actually is

Observed from a headless run of `createSoftBody()`:

- 338 particles, 108 of them on the boundary.
- Rest box width 2.40, height 1.147, outline area 1.195.

Source: the outline is resampled to 108 points, then filled with a hex interior. Clusters are global, head, thorax, abdomen, tail, dorsal, pectoral, and pelvic. The face is one decal in the eye’s frame, with singular values clamped to 0.5–1.85 and a reflection rejected. That is why the mouth and gills stay attached during ordinary stretches. It is also why the face cannot stretch as far as the candy around it.

### Solver, each substep

Source order in `SoftBody.substep`:

1. Verlet integration with gravity 11, linear damping 2.45, and shape springs. While a pull is held, those springs are scaled by 0.2.
2. Grab field.
3. Three passes of distance and bend constraints. Structural links are allowed to lock at 1.62 times rest and 0.84 times rest. During the first part of a landing those stiffnesses are multiplied by 0.22.
4. Area pressure, also reduced during that landing window.
5. Shape projection. 84% of the target is the full resting silhouette. In pull mode that silhouette is placed on the seat (`homeX`, `homeY`), not on the current center of mass.
6. A repair for a flipped boundary corner.
7. The grabbed particle is pinned to the pointer.
8. Walls. Floor restitution is 0. Side walls and the ceiling use restitution 0.16.
9. If the belly is on the floor and the landing window is over, every vertical velocity is multiplied by 0.35.

The frame step clamps `dt` to 0.033 seconds, then divides it into 3 substeps. There is no vertical home spring (`comKY` is 0). A horizontal spring (`comKX` 1.35) pulls the center back toward x = 0.

### Pull versus drop

This split is a reasonable patch for an earlier bug, and it is a limitation on the product.

In pull mode the pinched particle is moved to the pointer. Neighbors are moved toward `seat + pinchDisplacement * gaussian`, with `pullSigma` 0.62. Distant particles are pulled toward the seated rest pose (`holdAnchor` 0.3). On release, velocity inside that gaussian is scaled by `1 - weight`. The shape target stays on the seat. A fast release does not add the flick boost. That path is in `endGrab`.

In drop mode a smaller gaussian (`grabSigma` 0.27) is moved as a rigid neighborhood of the hand, and the carry offset eases toward the pointer (`carryFollow` 0.22). A release faster than 2.6 world units per second adds up to 0.85 extra speed on that neighborhood.

So the user must choose, before grabbing, whether they want a local stretch that forgets momentum, or a whole-body carry that can be thrown. A gummy does not work that way. A slow pinch and a fast yank are the same grip at two speeds. The mode switch prevents the failure mode where a pull launches the whole shark, by giving up the behavior the product asked for.

### Answers to the ten physics questions

Labels: **Observed** means a headless run of this solver or a browser session in this audit. **Source** means it follows from reading the code and was not separately measured.

1. **Is deformation localized?** Partly. Observed, headless, 24 frames at 1/60, pull mode. A 0.90 snout pull moved the snout by 0.90, a centerline point near x = 0 by 0.089, and the tail by −0.006. A 0.70 tail pull moved the tail by 0.70 and the snout by −0.039. The same pulls drove a boundary edge to 7.08 times and 6.56 times rest length. Localization of the center of the motion is real. Localization of strain is not. The pin is applied after the constraint solve, so the 1.62 cap does not bind the grabbed edge.

2. **Does the body keep connectivity and area?** Connectivity of the index list stays intact: particle coordinates stayed finite in every probe, and the boundary is still 108 edges. Area does not. Observed area ratios versus rest 1.195: snout pull 1.20, tail pull 1.33, dorsal pull **2.37**, belly pull 0.80, fold attempt **0.16**. Pressure and the stretch cap do not hold area once a particle is kinematic.

3. **Do head, body, tail, and fins behave as one material?** At rest and during a moderate snout pull, yes, visually. Under a dorsal pull the headless area more than doubles. In the browser the dorsal drag lifted the whole silhouette (top of the pink bounds rose about 110px, bottom rose about 30px) instead of lengthening only the fin. The lower fin drag did not extend a distinct fin; the belly outline flattened into the floor. They share a mesh, but the fins do not yet behave like the same candy as the torso.

4. **Does grab position change the deformation?** Yes. Observed in the headless matrix above, and in the browser: snout width 700px to 922px with the left edge almost fixed; tail left edge 364px to 226px with the right edge almost fixed.

5. **Does pointer velocity affect momentum?** Only in drop mode, and only above a threshold. Observed, headless: after a pull release, center x was 0.21 on the first frame and 0.03 by frame 30, with mean speed 4.91 then 0.25. After a drop flick, center x went from 1.19 to 3.71 over 40 frames at 1/60, mean speed still 2.84. Source confirms pull `endGrab` multiplies velocity by `1 - weight` and returns before the flick boost. In the browser, a fast pull stretched the snout to the screen edge and did not throw the body. A fast drop did throw it, into the wall, and broke it.

6. **Is recovery natural or anchored?** Anchored. Source: pull shape goals are rebuilt at `(homeX, homeY)` every substep, and distant particles are position-corrected toward the seat while grabbed. Observed: the snout pull returned the pink bounds from x = 374–1296 to x = 360–1062 within 0.9 seconds, matching the rest bounds x = 364–1064. That is a seat spring, not candy oscillating and settling where the mass is.

7. **Can it bend or fold convincingly?** No. Browser: dragging the snout toward the tail cut a notch under the head and left a thin spike on the lower tail. 0.7 seconds after release the notch was still there and the pink width was 622px versus 700px at rest. Headless fold: snout near the tail’s rest x, tail driven to y = 3.00, bounding height 4.46 versus rest 1.15, area 0.16. The seat anchor and the pin fight, and the outline collapses instead of creasing.

8. **Do fast drags create unstable forces?** The pose stays finite. The strain does not. Headless, one move of the snout by (2.4, −1.2) with pointer velocity (40, −30) produced a boundary edge of 9.75 times rest and a mean speed of 28. `maxSpeed` is 11 and limits the stored grab velocity, not the position. The pin writes the pointer position directly. Browser: a 3-step drag of about 1.6 shark-lengths put the snout against the right edge (2px of gap on a 1440px view) while the tail stayed put. The outline was still one filled shape, stretched thin, not a numerical explosion.

9. **Are collision and the floor believable?** The floor is the best part of the model. The walls are not. Observed, headless drop from 1.15 above the floor onto `maxY = 1.2`: first contact at frame 43, minimum height 0.697 versus rest 1.147, outline area 0.777 at the squash, belly never rose more than 0px off the contact test, height back to 1.118 and area to 1.000 by frame 179, mean speed 0.035. Browser at 1440×900: airborne height about 190–266px, impact frame height 162px with an 18px gap under the lowest pink pixel, settled height 256px versus rest 258px. Side walls use restitution 0.16 and a position push. Browser throw into the right wall: pink bounds collapsed to 246×386px with 7.8k pink samples versus about 21k at rest, and the picture is a shark split into a tail mass and a separate head mass. 0.7 seconds later the bounds were 664×144px and 9.7k samples, still on the right edge, still not a shark.

10. **Is behavior consistent across frame rates?** The pinned pose is. The velocity is not. Observed, same 0.40 second snout pull, pull mode:

| Frame dt | Frames | Snout dx | Tail dx | Area | Max boundary edge | Mean speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1/30 | 12 | 0.800 | −0.002 | 1.423 | 6.61 | 10.4 |
| 1/60 | 24 | 0.800 | −0.021 | 1.403 | 6.95 | 19.0 |
| 1/120 | 48 | 0.800 | −0.019 | 1.396 | 7.11 | 35.6 |

The grab writes a position, so the snout ends on the target at every rate. Mean speed scales roughly with `1/dt`. Constraint corrections change position without updating the previous position, so a similar position error becomes a larger velocity on a smaller substep. The app clamps a frame to 33ms, which avoids the worst hitch, and does nothing for a 120Hz frame. Source inference: this is the Verlet previous-position update, not a measured browser clock.

## 3. Tested functionality

### Headless solver

Script run with `vite-node` against this tree. Not committed. Cases: snout, tail, dorsal, belly, and mid-body pulls; pull release; drop flick; floor drop; three frame rates; fold; single-frame fast pull.

### Browser

Chrome 156, page `http://127.0.0.1:5173/`, CDP, `Emulation.setDeviceMetricsOverride`. The dev server was already the Vite app for this repo.

At 1440×900, after the intro settled:

- Rest.
- Slow snout pull and release.
- Tail pull.
- Dorsal pull.
- Lower-fin pull.
- Center press with a 4px move and release. This is only a tap-release, not a center stretch.
- Fast snout drag.
- Drag snout toward the tail, then release.
- Drop lift, fall, and settle.
- Drop throw toward the right edge.
- Resize from 1440×900 to 1280×720 while a grab was held.

Then a rest and a snout pull at 1280×720, 390×844, and 375×667.

Touch: one `Input.dispatchTouchEvent` sequence on the 390×844 snout. A `pointerdown` listener counted `pointerType === "touch"` once. The pink silhouette did not lengthen (256px wide versus 270px at the 390 rest shot). A real finger on a phone was not used.

### Commands

`npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` all exited 0 in this environment during the audit.

## 4. Passed requirements

These matched the product intent closely enough to call a pass.

- One shark, full-window canvas, no dashboard chrome. Two words and a fading hint. Observed.
- Rest pose reads as a shark: dorsal fin, pectoral point, tail, eye, gills, mouth. Width about 2.4 times the height in the mesh test, and the 1440px rest shot agrees. Observed.
- Moderate snout pull lengthens the head and leaves the tail seated, then returns to the same place. Browser pink width 700 → 922 → 702. Headless tail dx −0.006 during the pull. Observed.
- Moderate tail pull lengthens the tail and leaves the snout seated. Browser left edge 364 → 226, right edge stayed near 1060. Observed.
- Drop lifts the whole body and the shadow stays on the floor. Browser lift bounds y = 226–428 on a 900px view, large empty gap below. Observed.
- Floor contact shortens the body and does not bounce the belly up. Headless minimum height 0.697 of a 1.147 rest, `left = false`. Browser impact height 162px versus rest 258px, then 256px, bottom gap stayed about 18–24px. Observed.
- Face stays on the head for ordinary snout, tail, and floor poses. Observed in those screenshots. Source explains it: one eye frame, reflection rejected.
- Grabbing and releasing the center without travel does not throw the shark. Observed, with the caveat that the move was 4px.
- Simulation stayed finite for every headless case, including the fast pull and the fold.
- Frame time on this machine stayed near the display rate. See performance.

## 5. Failed requirements

- **Natural grab without a mode.** The user must pick pull or drop first. Pull cannot flick. Drop cannot pinch. Observed behavior matches the source split. This fails “naturally grab, stretch, and throw.”
- **Fold.** Browser notch and tail spike persist after release. Headless area falls to 16% of rest and the bounding height becomes 4.46. Not a crease in candy.
- **Wall collision.** Browser throw splits the shark. It is still crumpled 0.7 seconds later. Not a believable impact.
- **Fins as the same material.** Dorsal drag lifts the body. Lower-fin drag is swallowed by the floor and the fin silhouette disappears into the belly. Headless dorsal area 2.37 times rest.
- **Strain limit.** Stated cap is 1.62. Measured boundary ratios reached 7.08 (snout), 7.92 (snout up), 7.63 (dorsal), 9.75 (fast pull), 7.93 (fold). The cap is not actually enforced on the pinned particle.
- **Area.** Dorsal pull and the fold leave the conservation claim. The floor squash does return to area 1.00, so this is not a universal failure. It fails as soon as a grab fights the mesh.
- **Recovery after abuse.** Pull recovery of a moderate snout pull passes. Fold and wall impact do not restore a shark inside the observation window.
- **Fast drag.** Position follows the pointer even when that implies an edge many times too long. `maxSpeed` does not stop the teleport of the pin.
- **Resize while held.** Switching to 1280×720 during a grab left the shark flattened against the right and bottom edges (pink box 536×148, 8px from the right, 14px from the bottom). World grab coordinates were not rebuilt for the new pixels-per-unit, so the held point and the walls changed underneath the body.
- **375×667 pull.** Snout screen position was x = 326 of 375. A 0.5-length pull target falls outside the viewport. Pink width stayed 254 versus 256 at rest. The gesture did not stretch the shark.
- **390×844 pull clips.** Width grew 270 → 336 and the right gap fell to 2px. The stretch works and then runs out of screen.

## 6. Unverified requirements

- A long center-body stretch in the browser. The center interaction that was run was a 4px release. The headless mid-body pull did move that particle by 0.60 upward and the snout by 0.12, with an edge ratio of 6.07.
- Repeated rapid oscillation as its own scenario. Several grabs were chained and the frame rate held. A dedicated shake-for-several-seconds protocol was not timed separately.
- A fresh grab on the already-torn shark immediately after the wall hit. The post-hit frame shows the torn shape. A new pinch on that shape was not started.
- Real phone touch, multi-touch, and palm rejection. One synthesized touch produced a `pointerdown` and no visible stretch.
- GPU frame time, long tasks, and thermal behavior. Only `requestAnimationFrame` counts in this Chrome.
- Color appearance on a calibrated display. Screenshots were read from this machine’s capture.

## 7. Visual quality findings

**What is genuinely good.** At rest the silhouette is a shark, not a blob: tall dorsal fin, forked tail, a lower point, a snout, an eye, and three gill strokes. The palette is candy pink with a lighter rim and a soft table. The UI is two words. The shadow is drawn on the floor plane and fades when the body is lifted, which reads correctly in the drop shot. Ordinary snout stretch keeps the eye, gills, and mouth on the head. Sugar specks are small and do not dominate.

**Weaknesses, observed.**

- The body is opaque. The “translucency” is a lighter rim stroke, a screen-space white radial laid over the bounding box, and a darker core disc. Light does not travel through the candy. Stretching does not show a thinner, brighter section except by the outline getting narrower.
- Source, and consistent with the pictures: the candy gradient is rebuilt from the current screen bounding box every frame (`createLinearGradient` from `minY` to `maxY`). Pigment is not stuck to the material. A stretch re-maps color instead of carrying color with the gel.
- The lower fins read as one scalloped edge. After the pectoral drag they are visually gone, merged into the belly. At rest they are already the weakest part of the anatomy.
- The face clamp (source) keeps features attached and also keeps them from following a large stretch. On the fast pull the head is very long and the eye stays a small disc. That is stable, and it looks like a decal on rubber more than pigment in candy.
- Floor shadow is a flattened copy of the outline, scaled on Y and translated to the floor. It does not match contact patches. During the squash it is acceptable. During the torn wall pose it becomes a dark smear that does not explain the shape.
- Fold and wall poses are rendering the mesh honestly. The defect is the mesh, and the smooth Chaikin stroke (source: two Chaikin passes on the outline before fill) hides small spikes and cannot hide a split body.
- At 375 and 390 the shark is a small object on the bottom edge, under a large empty field. The hint still says “pull a spot.” The composition is intact and the shark is easy to miss with a thumb near the snout, because the snout is within about 50px of the right edge.

## 8. Physics limitations

These are the structural limits, not polish.

- The grab is kinematic. It runs after the constraint loop and writes the pointer into one particle. Any invariant that the constraints tried to restore is overwritten at that particle, and the neighboring edges inherit the error. That is why `maxStretch` and the area term do not describe a hard pull.
- Pull recovery is a seat, not viscosity. `poseCenter` forces the global shape target to `(homeX, homeY)` in pull mode. Combined with `holdAnchor`, the body is not free to keep a bend. It is free only while the pin overpowers a weak projection (`0.008` per substep while grabbed).
- Drop recovery of a gentle landing is good because the floor restitution is 0, planted particles are not lifted, and a short yield window (fatigue 0.55 seconds, soft constraints while fatigue > 0.12) lets the top fall in. That machinery is special-cased. It does not generalize to a wall or a fold.
- `settle` multiplies every vertical velocity by 0.35 once the belly is down and the window is over. That kills chatter. It also kills any residual candy wobble, which is part of why the settled shark feels placed rather than alive.
- Shape matching uses rotation only (polar factor, det forced to +1). Local clusters then outvote the global silhouette unless `applySilhouette` mixes 84% of the global pose back in. The global pose is why a landing can unsquash. It is also why a bend wants to stand back up.
- Frame-rate-dependent velocity comes from position corrections that are not written into the previous position. A faster display stores a larger fake speed for the same visual error. Pull mode then throws that speed away on release, which hides the bug. Drop mode can keep it.

## 9. Performance findings

Measured with `requestAnimationFrame` inside the page, this Chrome, this machine. Not estimated.

| Situation | Frames | Interval | Rate |
| --- | ---: | ---: | ---: |
| Idle, 1440×900, after intro | 61 | 1001.5 ms | 60.9 fps |
| After the 1440 interaction sequence | 61 | 1002.7 ms | 60.8 fps |
| Idle, 1280×720 | 49 | 803.1 ms | 61.0 fps |
| Idle, 390×844 | 49 | 802.2 ms | 61.1 fps |
| Idle, 375×667 | 49 | 800.9 ms | 61.2 fps |
| Idle after the touch attempt, 390×844 | 61 | 1001.0 ms | 60.9 fps |

The simulation did not miss frames in this environment while idle or after a long interaction. That does not measure a phone, and it does not measure the cost of the torn mesh separately. Production build output in this audit: `dist/assets/index-*.js` 31.57 kB (12.33 kB gzip), CSS 1.21 kB. The cost is one canvas draw of a few hundred particles. Performance is not the reason the toy fails.

## 10. Test coverage gaps

`npm test` in this audit: 10 tests, 2 files, all passed. Vitest 3.2.7. About 2.3 seconds.

`src/sim/math2.test.ts` (3) checks polar rotation: 90 degrees, uniform scale removed, 40 degrees with anisotropic scale, determinant +1. These are mathematical. They do not touch the shark.

`src/sim/softBody.test.ts` (7):

| Test | What it actually locks | What it does not lock |
| --- | --- | --- |
| Recognizable mesh | Boundary > 80, width near 2.4, taller-than-not, some dorsal/pectoral/tail points, finite eye | Looks like a shark to a person |
| Snout pull | Snout shift > 0.55, a mid particle moves, tail shift < 0.35 of the snout, over 18 frames | Edge ratio, area, visual smoothness |
| Drop carry | Center x > 0.28 and the snout leads the tail | That the outline survived |
| Floor | Touches, min height < 0.94 of rest, belly does not rise 0.06, mean speed < 1.2, finite | Walls, second impact, visual squash |
| Pull recovery | Snout x back under 0.55 of the pull after 6 seconds, speed < 1.2 | That it recovered by physics rather than the seat target |
| Unwind a flipped fin | One boundary turn’s sign is positive again, speed < 1.2 | A user fold |
| Fast flick | Drop mode, coordinates finite and inside ±8 | Shape quality after the flick |

The floor test and the snout test are real interaction checks of the solver. They would catch a return of the old hop, and they would catch a pull that moves the tail as much as the snout. They would not catch the failures in this audit. No test asserts area, maximum edge ratio, wall contact, fold quality, frame-rate speed, or a browser pixel.

`npm run typecheck`, `npm run lint`, and `npm run build` passed here. GitHub CI on the merged pull request ran GitGuardian only. The unit tests are not a required check.

There is no visual regression test and no viewport test.

## 11. Weighted scorecard

Scores are out of 10. They use only this audit’s measurements and screenshots.

| Criterion | Weight | Score | Why |
| --- | ---: | ---: | --- |
| Physical gummy feel | 30% | 5.2 | Floor squash and a moderate stretch feel soft. Fold, fins, area, and the seat spring do not feel like dense candy. |
| Grab, stretch, flick | 25% | 5.6 | Snout and tail pulls work and return. Flick exists only in drop, and that flick destroys the body on a wall. |
| Visual and material quality | 20% | 6.3 | Rest pose, color, rim, and shadow are pleasant. Material is opaque, shading is screen-space, abused poses look broken. |
| Stability | 10% | 4.2 | No NaNs. Wall hit and fold leave a non-shark. Edges reach 7–10× rest. Resize while held clips the body. |
| Mobile responsiveness | 5% | 3.8 | 390 and 375 render and idle at 61 fps. 375 pull does not stretch. 390 pull hits the edge. Touch event fired; a visible touch stretch was not observed. |
| Performance | 5% | 7.8 | About 61 fps on this machine at every viewport tested, including after the long 1440 session. No phone sample. |
| Engineering quality | 5% | 6.4 | Small typed codebase, parameters extracted, 10 real solver tests. Those tests miss the failure modes. CI does not run them. |

Weighted total: 5.2×0.30 + 5.6×0.25 + 6.3×0.20 + 4.2×0.10 + 3.8×0.05 + 7.8×0.05 + 6.4×0.05 = **5.54**, reported as **5.5 / 10**.

A real phone was not in the loop. The mobile score is for emulated viewports plus one CDP touch, not for a handset.

## 12. Top ten improvements, by impact

1. **Make the grab compliant.** Move the pinched particle with a stiff spring or a distance constraint, after or inside the constraint loop, and never write a position that implies an edge longer than the cap. This one change addresses the 7–10× edges, the area spikes, and a large part of the wall tear.
2. **Treat a wall like the floor.** Zero the outward speed, yield for a short window, and do not let the outline pass through itself. Add a test that throws the body at `maxX` and asserts area, max edge, and a single connected outline.
3. **One grip, two regimes.** Keep local falloff for a slow pull. If the release speed is high, keep that momentum instead of multiplying it by `1 - weight`, and do not retarget the shape to the seat during the flight. The mode buttons can stay as a convenience, but they should not be required for the basic feel.
4. **Area and strain tests with teeth.** Fail the suite if a dorsal pull doubles area or any boundary edge exceeds a chosen multiple of rest, for example 2.0, during a scripted grab. Today’s tests would stay green on this audit’s worst cases.
5. **Fins.** A dorsal grab should lengthen the fin and leave the belly on the floor. A pectoral grab should pull the fin, not disappear into the floor clamp. The floor’s “do not lift” rule needs a narrower band so a fin tip can still move.
6. **Fold as bending.** Allow a large rotation of the head cluster and keep edge lengths. Reject a result whose outline area falls below about 0.7 of rest. The current fold is a pin dragged through the seat anchor.
7. **Resize and screen edge.** On resize, rebuild the walls and convert the active grab into the new world scale before the next substep. Keep the rest pose inset from the right edge on narrow screens so a snout pull has room. 375×667 currently cannot show a pull.
8. **Recovery after damage.** If the outline area or an edge ratio crosses a limit, blend back to the seated pose over a short time. Today `broken()` only resets on non-finite values or coordinates past ±24, so a split shark is “healthy.”
9. **Stick the pigment to the body.** Shade in a material direction carried by the eye frame or by rest-space UVs, and let thickness darken or lighten the gel. The current bounding-box gradient is why stretch looks painted on.
10. **Run the unit tests in CI.** The suite is small and already fails closed on the hop. It is not protecting `main`.

## 13. Recommended V2 architecture

Do not replace the stack. Vite, Canvas 2D, and this particle list are enough.

Change the integrator’s contract:

- Constraints, including a hard strain clamp, are the last word on edge length. The pointer is a target, not an assignment.
- One grab kernel: gaussian falloff from the contact, compliance high near the finger and low at the tail. Release speed is kept, scaled by that same falloff, with a ceiling that the strain clamp can absorb.
- Shape matching stays rotation-only and weak, and it is expressed around the current center of mass. The seat is only a mild horizontal spring plus the floor. It is not a per-frame pose override, except as the emergency recovery in item 8.
- Floor and walls share one unilateral contact: kill outward speed, allow a short plastic yield, then restore edge lengths. No separate `releasePop`. That part of V1 is already the right idea and should be extended, not replaced.
- Previous positions are updated whenever a position is corrected, or velocities are recomputed once at the end of the substep from a stored pre-constraint position. That removes the frame-rate speed leak.
- Rendering can stay. Move the fill gradient into the deformed frame so color stretches with the gel. Keep the single face decal.

## 14. Acceptance criteria for V2

A change is not done until these are true on this mesh, at `dt` of 1/60, and the same checks at 1/30 and 1/120 differ by less than 10% on snout displacement, tail displacement, area ratio, and max edge ratio.

1. Snout pull of 0.9 over 0.4 seconds: snout moves at least 0.7, a particle near rest x = 0 moves less than half of that, the tail moves less than 0.15, every boundary edge stays ≤ 2.0 times rest, outline area stays within 0.85–1.25 of rest.
2. The same pull, released with pointer speed under 1: within 2 seconds the snout is within 0.15 of its seated rest and the tail has not translated more than 0.15. Mean speed under 0.3.
3. The same pull, released with pointer speed above 4, and no mode switch: the center of mass keeps moving the way of the pull for at least 0.3 seconds, and criterion 1’s edge and area limits still hold.
4. Dorsal pull of 0.55 upward: the top particle moves at least 0.35, the lowest particle moves less than 0.08, area stays within 0.85–1.25.
5. Dragging the snout to the tail’s rest x does not drop outline area below 0.70, and 2 seconds after release the silhouette’s bounding width is at least 0.85 of rest.
6. Drop from 1.15 onto the floor: height falls below 0.85 of rest, the lowest particle stays within 0.05 of the floor after first contact, and at 3 seconds area is within 0.95–1.05 of rest and mean speed is under 0.3.
7. Throw into `maxX` at speed above 6: no boundary edge over 2.0, area within 0.7–1.3 throughout, and at 2 seconds the outline bounding box has aspect at least 1.5 (width over height) so it is not a vertical scrap.
8. At 375×667 the snout’s rest screen x is at least 80px from the right edge, and a 0.5-length pull increases the pink bounding width by at least 15%.
9. Resize from 1440×900 to 1280×720 during a grab does not place any particle more than 0.05 outside the new walls, and the outline stays within the area limit.
10. The existing 10 tests still pass, plus new tests for 1, 4, 6, and 7. `npm test` runs in CI.

## 15. Evidence and reproduction

### This environment

- Commit tree `06e93ac29bb65fc4490b8710dbdcdaf32e3f7526`, identical to `origin/main` `af0ca3e`.
- Node and Chrome were already on the machine. Chrome 156. Vite answered `http://127.0.0.1:5173/` with HTTP 200. CDP was `http://127.0.0.1:9223/`.
- `npm test`, `typecheck`, `lint`, and `build` were run from `/workspace` on this branch and passed. The production build wrote gitignored `dist/`.

### Headless measurements

A temporary script imported `createSoftBody` from `src/sim/softBody.ts` and was deleted. It did not change solver code. Re-run the cases in section 2 and section 10 by constructing a body, setting `minX/maxX/minY/maxY`, calling `beginGrab` / `moveGrab` / `step(1/60)` / `endGrab`, and logging outline area, boundary edge ratios, and bounding boxes. The tables in this document are that run.

### Browser measurements

Viewports were set with `Emulation.setDeviceMetricsOverride`. Pointer moves used `Input.dispatchMouseEvent`. Touch used `Input.dispatchTouchEvent`. Screenshots were `Page.captureScreenshot`. Pink bounds were counted with a threshold of red > 185, green < 150, blue > 70, red > green + 45, and y below the top quarter, sampled every 2 pixels.

Representative shots from this pass:

- `audit-rest-1440.png`, `audit-pull-snout.png`, `audit-pull-recovered.png`
- `audit-pull-tail.png`, `audit-pull-dorsal.png`, `audit-pull-pectoral.png`
- `audit-fast-pull.png`, `audit-fold-attempt.png`, `audit-fold-after.png`
- `audit-drop-lift.png`, `audit-land-3.png`, `audit-land-settled.png`
- `audit-throw-wall.png`, `audit-throw-after.png`
- `audit-resize-while-held.png`
- `audit-rest-375x667.png`, `audit-pull-375x667.png`, `audit-pull-390x844.png`, `audit-touch-390.png`

Frame counts are in section 9. They came from a `requestAnimationFrame` loop in the page, not from an estimate.

### How to read the labels

If a sentence says “observed,” it happened in the headless script or in Chrome during this audit. If it says “source,” it is an explanation read from `src/` and was not given its own measurement. The mode split, the seat target, the pin-after-constraints order, the face clamp, and the screen-space gradient are source. Their visible consequences were checked in the browser where section 3 says they were.
