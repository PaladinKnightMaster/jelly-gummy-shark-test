/**
 * Tunable soft-body parameters.
 *
 * World units: the resting shark is about 2.4 long. Y grows downward.
 * Time is in seconds. Springs are accelerations (1/s^2) toward a shape goal.
 */
export const PARAMS = {
  /** Constant downward acceleration. */
  gravity: 3.6,
  /** Pulls the center of mass back home so a hard throw stays recoverable. */
  comK: 6.4,
  /** Exponential velocity decay rate (1/s). Higher settles faster. */
  linearDamp: 2.45,
  /** Extra drag that grows with speed, so flicks travel but do not fly forever. */
  quadDamp: 0.06,
  substeps: 3,
  constraintIterations: 3,
  /** Fractional correction of structural links per iteration, inside the stretch limit. */
  distanceStiffness: 0.14,
  boundaryStiffness: 0.28,
  /** Gentle curvature links. Low, so the body can bend. */
  bendStiffness: 0.045,
  /** How far a structural link may stretch or compress before it locks. */
  maxStretch: 1.62,
  minStretch: 0.84,
  /** How strongly area loss pushes the outline back out. */
  pressure: 0.28,
  /** Material radius of a grab, in world units. */
  grabSigma: 0.27,
  /** How quickly grabbed material moves to the pointer each substep. 1 is instant. */
  grabFollow: 0.94,
  /**
   * While a point is held, fraction of the way distant particles are pulled back
   * toward their rest pose each substep. Keeps a pull local.
   */
  holdAnchor: 0.42,
  maxSpeed: 11,
  /** Pointer speed above which a release is treated as a flick. */
  flickSpeed: 2.6,
  /** Extra velocity multiplier applied to fast releases. */
  flickBoost: 0.85,
  restitution: 0.22,
  /** Fraction of wall penetration removed per substep. */
  wallPush: 0.42,
  breathAmp: 0.014,
  breathOmega: 1.7,
  idleSpeed: 0.22,
  /** Angular spring back toward the original upright pose, in 1/s^2 per radian. */
  uprightK: 12,
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
