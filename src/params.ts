/**
 * Tunable soft-body parameters.
 *
 * World units: the resting shark is about 2.4 long. Y grows downward.
 * Time is in seconds. Springs are accelerations (1/s^2) toward a shape goal.
 */
export const PARAMS = {
  /** Constant downward acceleration. Dense enough to fall, not to rocket. */
  gravity: 11,
  /** Gentle horizontal return so a toss stays on the table. */
  comKX: 1.35,
  /** Vertical spring. Zero lets the floor, not a hidden home point, hold the shark. */
  comKY: 0,
  /** Exponential velocity decay rate (1/s). Higher settles faster. */
  linearDamp: 2.45,
  /** Extra drag that grows with speed, so flicks travel but do not fly forever. */
  quadDamp: 0.06,
  substeps: 3,
  constraintIterations: 4,
  /**
   * Hard projections of over-stretched links after the grab.
   * One sweep propagates the excess by about one edge, so a handful
   * of sweeps is enough when the grab itself only moves a short step.
   */
  enforcePasses: 16,
  /** Fractional correction of structural links per iteration, inside the stretch limit. */
  distanceStiffness: 0.22,
  boundaryStiffness: 0.42,
  /** Gentle curvature links. Low, so the body can bend. */
  bendStiffness: 0.05,
  /**
   * Structural links lock here. The grab is not allowed to leave an edge
   * outside this band; the last solver pass projects every limited edge back in.
   * minStretch is low enough for a landing to shorten the candy, and high
   * enough that the outline cannot collapse into a ribbon.
   */
  maxStretch: 1.62,
  minStretch: 0.72,
  /** How strongly area loss pushes the outline back out. */
  pressure: 0.42,
  /**
   * Material radius of a grab, in world units.
   * Neighbors inside this radius share the pointer step; the tail does not.
   */
  grabSigma: 0.5,
  /**
   * Fraction of a pointer step applied to the whole body.
   * The rest is a local stretch. Once the local edges are at their lock,
   * this part is what keeps a sustained drag moving the shark instead of
   * pinning it in a stretched pose.
   */
  carry: 0.34,
  /**
   * How fast the pinched region may chase the pointer, in world units per second.
   * A slow pull still reaches the finger. A jump across the screen is absorbed
   * over several frames so edges can be projected back under maxStretch.
   */
  grabSpeed: 11,
  maxSpeed: 9,
  /** Walls are inelastic, same idea as the floor: hit, shorten, stay. */
  restitution: 0,
  /** Fraction of wall penetration removed per contact pass. */
  wallPush: 0.92,
  /** Floor contact removes the hit. A gummy shortens and stops. */
  floorPush: 0.95,
  /** Downward speed that starts a soft landing, so the body can shorten. */
  impactSpeed: 1,
  breathAmp: 0.014,
  breathOmega: 1.7,
  idleSpeed: 0.22,
  /** Angular spring back toward the original upright pose, in 1/s^2 per radian. */
  uprightK: 12,
  /** Share of the shape target taken from the full resting silhouette. */
  silhouette: 0.84,
  /** While a hand is on the candy, let local clusters bend instead of standing the pose back up. */
  silhouetteHeld: 0.28,
  /** Shape-matching spring strengths. Local clusters keep the shark recognizable. */
  globalK: 10,
  globalWeight: 0.28,
  headK: 42,
  thoraxK: 30,
  abdomenK: 24,
  tailK: 20,
  dorsalK: 28,
  pectoralK: 24,
  pelvicK: 22,
};
