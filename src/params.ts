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
   * In pull mode, how hard distant candy stays seated each substep.
   * The pinched spot still follows the pointer.
   */
  holdAnchor: 0.44,
  /** In drop mode, how quickly the whole shark catches the hand, per substep. */
  carryFollow: 0.22,
  maxSpeed: 11,
  /** Pointer speed above which a release is treated as a flick. */
  flickSpeed: 2.6,
  /** Extra velocity multiplier applied to fast releases. */
  flickBoost: 0.85,
  restitution: 0.16,
  /** Fraction of wall penetration removed per substep. */
  wallPush: 0.42,
  /** Floor contact. Firmer than the side walls so a landing can compress. */
  floorPush: 0.9,
  /**
   * Share of impact speed returned upward. Low, so a gummy hops once
   * instead of launching.
   */
  floorPop: 0.58,
  /** Impact speed above which the body compresses and rebounds. */
  impactSpeed: 2.45,
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
