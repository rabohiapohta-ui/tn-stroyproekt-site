/**
 * Independent controls for the existing TN_Excavator.glb.
 * Pass the same THREE namespace used by GLTFLoader; this module has no imports.
 * Construct immediately after loading, before playing any baked animation.
 * Stop/uncache the baked clip before calling setPose; two writers must not own a rig.
 * Angle values are degrees relative to the native exported rest pose.
 */
export const EXCAVATOR_LIMITS = Object.freeze({
  slew: Object.freeze({ min: -180, max: 180, step: 1 }),
  boom: Object.freeze({ min: -15, max: 0, step: 0.1 }),
  stick: Object.freeze({ min: 0, max: 15, step: 0.1 }),
  bucket: Object.freeze({ min: 0, max: 30, step: 0.1 }),
});

const JOINT_NAMES = {
  slew: '02_SLEW_PIVOT', boom: '03_BOOM_PIVOT',
  stick: '04_STICK_PIVOT', bucket: '05_BUCKET_PIVOT',
};
const ZERO = Object.freeze({ slew: 0, boom: 0, stick: 0, bucket: 0 });
const cleanName = (s) => s.replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');
const DEG = Math.PI / 180;

/** Matches both raw glTF names and the names sanitized by Three's GLTFLoader. */
function resolve(scene, name) {
  const matches = [];
  scene.traverse((o) => {
    if (o.name === name || o.name === cleanName(name) || o.userData?.name === name) matches.push(o);
  });
  if (matches.length !== 1) throw new Error(`Expected one rig node "${name}"; found ${matches.length}.`);
  return matches[0];
}

export function createExcavatorRig(scene, THREE, options = {}) {
  const root = resolve(scene, 'TN_EXCAVATOR_ROOT');
  const joints = Object.fromEntries(Object.entries(JOINT_NAMES).map(([k, name]) => [k, resolve(root, name)]));
  const P = resolve(root, 'Bucket linkage | fixed fulcrum');
  const Q = resolve(root, 'Bucket linkage | moving fulcrum');
  const C = resolve(root, 'Bucket linkage | bucket attachment');
  const rocker = resolve(root, 'Bucket rocker');
  const connecting = resolve(root, 'Bucket connecting link');
  if (P.parent !== joints.stick || Q.parent !== joints.stick || C.parent !== joints.bucket) {
    throw new Error('Unsupported bucket hierarchy; load the original TN_Excavator.glb.');
  }
  const limits = options.limits || EXCAVATOR_LIMITS;
  const tolerance = options.tolerance ?? 0.00002;
  // A visual model has no certified stroke limits. Reserve 2 cm before its
  // nominal barrel/rod endpoints so the piston remains visibly engaged.
  const strokeMargin = options.strokeMargin ?? 0.02;
  let hydraulicMetadata;
  try {
    const raw = root.userData.hydraulics_json;
    hydraulicMetadata = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!hydraulicMetadata || Object.keys(hydraulicMetadata).length !== 4) throw new Error('Missing cylinders');
  } catch { throw new Error('The GLB must provide its original root hydraulics_json extras.'); }
  const hydraulics = Object.entries(hydraulicMetadata).map(([name, h]) => ({
    name, a: resolve(root, h.a), b: resolve(root, h.b),
    barrel: resolve(root, h.barrel), piston: resolve(root, h.piston),
    barrelLength: Number(h.barrel_length), rodLength: Number(h.rod_length),
  }));
  for (const h of hydraulics) {
    if (!(h.barrelLength > 0 && h.rodLength > 0)) throw new Error(`Invalid lengths for ${h.name}.`);
  }
  const controlled = [...Object.values(joints), Q, rocker, connecting,
    ...hydraulics.flatMap((h) => [h.barrel, h.piston])];
  const snapshot = () => controlled.map((node) => ({ node, position: node.position.clone(),
    quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
  const native = snapshot();
  const nativeByNode = new Map(native.map((t) => [t.node, t]));
  const nativePose = { ...ZERO };
  const world = (node) => node.getWorldPosition(new THREE.Vector3());
  const inRoot = (node) => root.worldToLocal(world(node));
  const inStick = (node) => joints.stick.worldToLocal(world(node));
  const update = () => root.updateWorldMatrix(true, true);
  const restore = (transforms) => {
    for (const t of transforms) {
      t.node.position.copy(t.position); t.node.quaternion.copy(t.quaternion); t.node.scale.copy(t.scale);
    }
    update();
  };
  update();
  const p0 = inStick(P), c0 = inStick(C), q0 = inStick(Q);
  const d0 = c0.clone().sub(p0), d20 = d0.x * d0.x + d0.y * d0.y;
  const k0 = (0.44 ** 2 - 0.42 ** 2 + d20) / (2 * d20);
  const branch = ((q0.x - p0.x - k0 * d0.x) * d0.y -
    (q0.y - p0.y - k0 * d0.y) * d0.x) >= 0 ? 1 : -1;

  // Native longitudinal axis is +Y after glTF's (x,y,z)->(x,z,-y)
  // conversion. Swinging the native quaternion retains its original roll.
  function aim(node, target) {
    const rest = nativeByNode.get(node);
    const direction = node.parent.worldToLocal(world(target)).sub(node.position);
    if (direction.lengthSq() < 1e-12) throw new Error('Coincident hydraulic anchors.');
    direction.normalize();
    const restDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(rest.quaternion).normalize();
    node.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(restDirection, direction)
      .multiply(rest.quaternion).normalize());
  }

  function solveLinkage() {
    update();
    const p = inStick(P), c = inStick(C);
    const dx = c.x - p.x, dy = c.y - p.y, d2 = dx * dx + dy * dy;
    if (Math.abs(c.z - p.z) > tolerance || d2 < 1e-12) return 'Degenerate bucket linkage.';
    const distance = Math.sqrt(d2);
    if (distance > 0.86 - 0.00001 || distance < 0.02 + 0.00001) return 'Bucket linkage is outside its reachable interval.';
    const k = (0.44 ** 2 - 0.42 ** 2 + d2) / (2 * d2);
    const h2 = 0.44 ** 2 / d2 - k * k;
    if (h2 < 0) return 'Bucket linkage has no real solution.';
    const h = branch * Math.sqrt(h2);
    Q.position.set(p.x + k * dx + h * dy, p.y + k * dy - h * dx, nativeByNode.get(Q).position.z);
    update();
    aim(rocker, Q); aim(connecting, C);
    for (const h of hydraulics) { aim(h.barrel, h.b); aim(h.piston, h.a); }
    update();
    return null;
  }

  function inspect() {
    update();
    const p = inRoot(P), q = inRoot(Q), c = inRoot(C);
    const lengths = [p.distanceTo(q), q.distanceTo(c)];
    const closureError = Math.max(Math.abs(lengths[0] - 0.44), Math.abs(lengths[1] - 0.42));
    const cylinders = hydraulics.map((h) => {
      const distance = inRoot(h.a).distanceTo(inRoot(h.b));
      const extension = distance - h.barrelLength;
      const remainingOverlap = h.barrelLength + h.rodLength - distance;
      // Source geometry has a gland ending at L+.027 and a rod end .04
      // from B. This is the visible straight chrome span, not piston stroke.
      const visibleChrome = Math.max(0, distance - h.barrelLength - 0.067);
      return { name: h.name, anchorDistance: distance, extension, remainingOverlap, visibleChrome,
        minDistance: h.barrelLength + strokeMargin,
        maxDistance: h.barrelLength + h.rodLength - strokeMargin,
        valid: distance >= h.barrelLength + strokeMargin - tolerance &&
          distance <= h.barrelLength + h.rodLength - strokeMargin + tolerance };
    });
    let groundClearance = null;
    // Supply the model's small precomputed XY hull to also reject bucket/floor
    // intersections. Units and floor are in the root's native model space.
    if (options.bucketHullXY) {
      groundClearance = Infinity;
      for (const [x, y] of options.bucketHullXY) {
        const p = root.worldToLocal(joints.bucket.localToWorld(new THREE.Vector3(x, y, 0)));
        groundClearance = Math.min(groundClearance, p.y - (options.floorY ?? 0));
      }
    }
    const failures = [];
    if (!(closureError <= tolerance)) failures.push('Bucket linkage did not close.');
    for (const h of cylinders) if (!h.valid) failures.push(`${h.name}: cylinder travel exceeded.`);
    if (groundClearance !== null && groundClearance < (options.groundMargin ?? 0.02) - tolerance) {
      failures.push('Bucket is too close to the model ground plane.');
    }
    return { valid: failures.length === 0, failures, closureError,
      linkLengths: lengths, cylinders, groundClearance };
  }

  let pose = { ...nativePose };
  let lastDiagnostics = inspect();
  if (!lastDiagnostics.valid) throw new Error(`Invalid native rig: ${lastDiagnostics.failures.join(' ')}`);

  function setPose(input = {}) {
    const proposed = { ...pose };
    const clamped = [];
    for (const key of Object.keys(input)) {
      if (!(key in ZERO)) return { ok: false, pose: { ...pose }, reason: `Unknown joint: ${key}.` };
      if (typeof input[key] !== 'number' || !Number.isFinite(input[key])) {
        return { ok: false, pose: { ...pose }, reason: `Invalid angle for ${key}.` };
      }
      proposed[key] = Math.max(limits[key].min, Math.min(limits[key].max, input[key]));
      if (proposed[key] !== input[key]) clamped.push(key);
    }
    const before = snapshot();
    try {
      if (Object.values(proposed).every((n) => n === 0)) {
        restore(native);
      } else {
        for (const [key, joint] of Object.entries(joints)) {
          const axis = key === 'slew' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);
          joint.quaternion.copy(nativeByNode.get(joint).quaternion)
            .multiply(new THREE.Quaternion().setFromAxisAngle(axis, proposed[key] * DEG));
        }
        const failure = solveLinkage();
        if (failure) { restore(before); return { ok: false, pose: { ...pose }, reason: failure }; }
      }
      const diagnostics = inspect();
      if (!diagnostics.valid) {
        restore(before);
        return { ok: false, pose: { ...pose }, reason: diagnostics.failures.join(' '), diagnostics };
      }
      pose = proposed; lastDiagnostics = diagnostics;
      return { ok: true, pose: { ...pose }, clamped, diagnostics };
    } catch (error) {
      restore(before);
      return { ok: false, pose: { ...pose }, reason: error.message };
    }
  }

  return {
    root, joints, limits, setPose,
    getPose: () => ({ ...pose }),
    getDiagnostics: () => structuredClone(lastDiagnostics),
    reset: () => setPose(ZERO),
    /** Restore all controlled native transforms when removing manual controls. */
    restoreNativeRest() { restore(native); pose = { ...ZERO }; lastDiagnostics = inspect(); },
    /** Same 8-second motion as the authored 193-frame source, continuously solved. */
    demonstrate(seconds) {
      if (!Number.isFinite(seconds)) return { ok: false, pose: { ...pose }, reason: 'Invalid time.' };
      const t = ((seconds % 8) + 8) % 8 / 8;
      const u = Math.sin(Math.PI * t) ** 2;
      return setPose({ slew: 0.27 * Math.sin(2 * Math.PI * t) * u / DEG,
        boom: -0.14 * u / DEG, stick: 0.23 * u / DEG, bucket: 0.46 * u / DEG });
    },
  };
}
