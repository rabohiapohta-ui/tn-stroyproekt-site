/**
 * Independent looping motion for createExcavatorRig(). No Three.js dependency.
 * Call update(deltaSeconds) once per frame. hasActive is a boolean getter.
 * Stop other animation writers before using this controller. stop/stopAll freeze
 * the accepted pose without writing to the rig; they preserve resumable phases.
 */
export const JOINT_LOOP_DEFAULTS = Object.freeze({
  slew: Object.freeze({ min: -35, max: 35, period: 12 }),
  boom: Object.freeze({ min: -15, max: 0, period: 6 }),
  stick: Object.freeze({ min: 0, max: 15, period: 5.5 }),
  bucket: Object.freeze({ min: 0, max: 30, period: 5 }),
});

const IDS = Object.freeze(Object.keys(JOINT_LOOP_DEFAULTS));
const TAU = Math.PI * 2;
const SAME_POSE_EPSILON = 1e-8;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Optional settings: fadeInSeconds (default .35), periods {joint: seconds}.
 * The ranges deliberately stay inside the existing rig's practical limits.
 */
export function createJointLoops(rig, options = {}) {
  if (!rig || typeof rig.getPose !== 'function' || typeof rig.setPose !== 'function') {
    throw new TypeError('Joint loops require a rig with getPose() and setPose().');
  }
  const fadeIn = options.fadeInSeconds ?? 0.35;
  if (!Number.isFinite(fadeIn) || fadeIn < 0) throw new RangeError('fadeInSeconds must be finite and nonnegative.');
  const config = Object.fromEntries(IDS.map(id => {
    const c = { ...JOINT_LOOP_DEFAULTS[id], period: options.periods?.[id] ?? JOINT_LOOP_DEFAULTS[id].period };
    if (!Number.isFinite(c.period) || c.period <= 0) throw new RangeError(`Invalid loop period for ${id}.`);
    return [id, c];
  }));
  const states = new Map(IDS.map(id => [id, {
    active: false, trajectory: null, clockBase: 0, age: 0, motionTime: 0, lastAngle: null,
  }]));
  function stateFor(id) {
    const s = states.get(id);
    if (!s) throw new RangeError(`Unknown excavator joint: ${id}.`);
    return s;
  }

  // Integral of smoothstep speed from rest to normal playback speed. Keeping
  // an analytic clock makes one large delta equivalent to partitioned deltas.
  function clockAdvance(age) {
    if (fadeIn === 0) return age;
    if (age >= fadeIn) return age - fadeIn / 2;
    const u = age / fadeIn;
    return fadeIn * (u * u * u - 0.5 * u * u * u * u);
  }

  function newTrajectory(id, angle) {
    const { min, max, period } = config[id];
    const middle = (min + max) / 2, amplitude = (max - min) / 2;
    const entryTarget = clamp(angle, min, max);
    // A pre-existing platform pose may lie outside ±35°. Reach the nearest
    // oscillation endpoint smoothly instead of clamping or resetting it.
    const entryDuration = angle === entryTarget ? 0 : Math.max(0.6, Math.abs(entryTarget - angle) / 24);
    const phase = -Math.acos(clamp((entryTarget - middle) / amplitude, -1, 1));
    return { start: angle, entryTarget, entryDuration, phase, middle, amplitude, period };
  }
  function angleAt(t, motionTime) {
    if (motionTime === 0) return t.start;
    if (motionTime < t.entryDuration) {
      const u = motionTime / t.entryDuration;
      return t.start + (t.entryTarget - t.start) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    }
    const cycleTime = (motionTime - t.entryDuration) % t.period;
    return t.middle + t.amplitude * Math.cos(t.phase + TAU * cycleTime / t.period);
  }

  function stop(id) {
    const s = stateFor(id), wasActive = s.active;
    s.active = false;
    // Pause is an exact freeze: no get/setPose, extrapolation or endpoint snap.
    s.clockBase = s.motionTime;
    s.age = 0;
    return wasActive;
  }
  function stopAll() {
    for (const id of IDS) stop(id);
  }
  function toggle(id) {
    const s = stateFor(id);
    if (s.active) { stop(id); return false; }
    const angle = rig.getPose()[id];
    if (!Number.isFinite(angle)) throw new TypeError(`Rig returned an invalid angle for ${id}.`);
    if (!s.trajectory || Math.abs(angle - s.lastAngle) > SAME_POSE_EPSILON) {
      // A reset or another controller may have changed this paused joint.
      // Start from that actual pose rather than replaying a stale phase.
      s.trajectory = newTrajectory(id, angle);
      s.clockBase = 0;
      s.motionTime = 0;
      s.lastAngle = angle;
    } else {
      s.clockBase = s.motionTime;
    }
    s.age = 0;
    s.active = true;
    return true;
  }

  function update(delta) {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Loop delta must be finite and nonnegative.');
    if (delta === 0 || !IDS.some(id => states.get(id).active)) return { ok: true, changed: false };
    const updates = [], patch = {};
    for (const id of IDS) {
      const s = states.get(id);
      if (!s.active) continue;
      const age = s.age + delta;
      const time = s.clockBase + clockAdvance(age);
      patch[id] = angleAt(s.trajectory, time);
      updates.push({ id, age, time });
    }
    // A partial patch updates every active joint together and leaves every
    // inactive joint exactly where it currently is, including external edits.
    let result;
    try { result = rig.setPose(patch); }
    catch (error) { stopAll(); return { ok: false, changed: false, reason: error.message }; }
    if (!result?.ok) {
      stopAll();
      return { ...(result || {}), ok: false, changed: false, reason: result?.reason || 'Rig rejected loop pose.' };
    }
    // Commit the clocks only after the rig accepts the entire pose.
    for (const { id, age, time } of updates) {
      const s = states.get(id);
      s.age = age;
      s.motionTime = time;
      s.lastAngle = result.pose?.[id] ?? patch[id];
    }
    return { ...result, changed: true };
  }

  return {
    toggle, stop, stopAll, update,
    isActive(id) { return stateFor(id).active; },
    get hasActive() { return IDS.some(id => states.get(id).active); },
  };
}
