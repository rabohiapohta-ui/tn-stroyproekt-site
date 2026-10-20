/**
 * Isolated, static details from TN_Excavator_Realism.glb.
 *
 * const parts = createDetailParts(gltf, THREE); // prefer the whole GLTF result
 * detailScene.add(parts.cab);
 * const { bounds, target, cameraPosition } = parts.cab.userData.detail;
 * setCabInterior(parts.cab, true); // hides shell, preserves seat AND monitor
 * const interiorView = parts.cab.userData.detail.interior;
 * const cabFocus = createCabFocusParts(gltf, THREE); // { seat, controls }
 *
 * Returns { cab, engine, tracks, bucket, hydraulics }, each a THREE.Group.
 * All groups use glTF coordinates (+Y up), are centered in X/Z, and sit at Y=0.
 * They own their new BufferGeometry / index buffers. Vertex attributes,
 * materials, and textures are shared with the source. Cache these groups when
 * closing a modal. At final scene teardown dispose only their new geometries;
 * never dispose shared materials / textures independently of the source.
 *
 * A complete GLTFLoader result restores original GLB node transforms without
 * touching the live model, including when its rig is already moving. An
 * Object3D argument captures its current pose: call before starting animation.
 * No source objects, attributes, materials, or rig controls are modified.
 */

const DETAIL_INFO = {
  cab: {
    title: 'Кабина',
    description: 'Кабина оператора: кресло с подголовником, два пульта с джойстиками, педали, остекление, зеркала и рабочие фары.',
    cameraDirection: [1.05, 0.60, -1.15],
    limitation: 'Дверь и органы управления показаны в неподвижном положении.',
  },
  engine: {
    title: 'Моторный отсек',
    description: 'Наружный моторный отсек: защитные панели, вентиляционные решётки, воздухозаборник, выхлопная труба и площадка обслуживания.',
    cameraDirection: [-1.10, 0.70, -1.15],
    limitation: 'Показан наружный корпус отсека. Внутренний двигатель в исходной модели отсутствует.',
  },
  tracks: {
    title: 'Ходовая часть',
    description: 'Две гусеницы, опорные катки, ведущие колёса, несущая рама и поворотное опорное кольцо.',
    cameraDirection: [1.10, 0.67, -1.35],
    limitation: 'Гусеничные ленты показаны статично.',
  },
  bucket: {
    title: 'Ковш',
    description: 'Ковш с зубьями, усиленными боковыми стенками, наружными износостойкими полосами и узлом крепления.',
    cameraDirection: [-1.20, 0.68, -1.05],
    limitation: 'Показан ковш с креплением; рукоять и внешняя рычажная тяга не входят в этот вид.',
  },
  hydraulics: {
    title: 'Гидравлический цилиндр',
    description: 'Левый цилиндр подъёма стрелы: окрашенный корпус, хромированный шток, проушины, уплотнение и маслопровод.',
    cameraDirection: [0.95, 0.45, -1.65],
    limitation: 'Для крупного вида выделен один целый цилиндр подъёма стрелы. Внутренний разрез не моделировался.',
  },
};

// Kept separate from DETAIL_INFO so createDetailParts retains its original
// five-group return shape and existing callers need no changes.
const CAB_FOCUS_INFO = {
  seat: {
    title: 'Кресло оператора',
    description: 'Кресло со спинкой, подголовником, подлокотниками и основанием.',
    cameraDirection: [1.15, .55, -1.05],
    limitation: 'Положение деталей соответствует исходной модели.',
  },
  controls: {
    title: 'Органы управления',
    description: 'Два пульта с джойстиками, педали, рычаги движения и монитор с кнопками.',
    cameraDirection: [1.15, .80, -1.05],
    limitation: 'Органы управления показаны вместе, в их исходном расположении в кабине.',
  },
};

const canonicalName = (name) => (name || '').replace(/[\s|]+/g, '_').replace(/_+/g, '_');

function isUppercarriagePrimitive(object, slew) {
  // A GLB mesh with several materials becomes a Group of primitive meshes in
  // GLTFLoader. V5 adds such cab/engine hardware groups immediately below
  // slew. Allow their wrapper without admitting boom or hydraulic rig nodes.
  let parent = object.parent;
  while (parent && parent !== slew) {
    const name = canonicalName(parent.name);
    if (!name.startsWith('02_SLEW_PIVOT_') && !name.startsWith('V5_details_') && !name.startsWith('Refined_cab_')) return false;
    parent = parent.parent;
  }
  return parent === slew;
}

function transformReader(input, scene, THREE) {
  const parser = input && input.parser;
  const json = parser && parser.json;
  const associations = parser && parser.associations;
  if (!json?.nodes || !associations?.get) {
    scene.updateWorldMatrix(true, true);
    return { pose: 'current-pose-snapshot', world: (object) => object.matrixWorld.clone() };
  }
  const parents = new Int32Array(json.nodes.length).fill(-1);
  json.nodes.forEach((node, i) => (node.children || []).forEach((child) => { parents[child] = i; }));
  const matrices = new Map();
  function nodeWorld(index) {
    if (matrices.has(index)) return matrices.get(index);
    const node = json.nodes[index];
    const local = node.matrix
      ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
        new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
        new THREE.Vector3().fromArray(node.scale || [1, 1, 1]),
      );
    const world = parents[index] < 0 ? local : nodeWorld(parents[index]).clone().multiply(local);
    matrices.set(index, world);
    return world;
  }
  function world(object) {
    const belowNode = [];
    for (let cursor = object; cursor; cursor = cursor.parent) {
      const association = associations.get(cursor);
      if (association?.nodes !== undefined) {
        const matrix = nodeWorld(association.nodes).clone();
        for (let i = belowNode.length - 1; i >= 0; i--) matrix.multiply(belowNode[i]);
        return matrix;
      }
      // A GLTF primitive beneath a named node may not itself be associated
      // with a node. Preserve its local mesh transform without changing it.
      const matrix = cursor.matrixAutoUpdate
        ? new THREE.Matrix4().compose(cursor.position, cursor.quaternion, cursor.scale)
        : cursor.matrix.clone();
      belowNode.push(matrix);
    }
    throw new Error(`No source GLTF node association for ${object.name}. Pass the original GLTF result or its scene before animation.`);
  }
  return { pose: 'original-gltf-rest-pose', world };
}

function connectedComponents(geometry, matrix, THREE) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const vertexAt = (offset) => index ? index.getX(offset) : offset;
  const parents = new Int32Array(position.count);
  const rank = new Uint8Array(position.count);
  for (let i = 0; i < parents.length; i++) parents[i] = i;
  function find(i) {
    while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
    return i;
  }
  function join(a, b) {
    a = find(a); b = find(b);
    if (a === b) return;
    if (rank[a] < rank[b]) { parents[a] = b; return; }
    parents[b] = a;
    if (rank[a] === rank[b]) rank[a]++;
  }
  // GLTF exports duplicate positions along UV seams / hard normals. Weld
  // only for connectivity analysis; original positions and UVs stay intact.
  const atPosition = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 1e5)},${Math.round(position.getY(i) * 1e5)},${Math.round(position.getZ(i) * 1e5)}`;
    const other = atPosition.get(key);
    if (other === undefined) atPosition.set(key, i); else join(i, other);
  }
  for (let offset = 0; offset + 2 < count; offset += 3) {
    join(vertexAt(offset), vertexAt(offset + 1));
    join(vertexAt(offset), vertexAt(offset + 2));
  }
  const result = new Map();
  const vertex = new THREE.Vector3();
  for (let offset = 0; offset + 2 < count; offset += 3) {
    const id = find(vertexAt(offset));
    let component = result.get(id);
    if (!component) {
      component = { offsets: [], bounds: new THREE.Box3() };
      result.set(id, component);
    }
    component.offsets.push(offset);
    for (let corner = 0; corner < 3; corner++) {
      vertex.fromBufferAttribute(position, vertexAt(offset + corner)).applyMatrix4(matrix);
      component.bounds.expandByPoint(vertex);
    }
  }
  return [...result.values()];
}

function selectedGeometry(source, triangleOffsets, THREE) {
  const original = source.geometry;
  const position = original.getAttribute('position');
  const sourceIndex = original.getIndex();
  const count = sourceIndex ? sourceIndex.count : position.count;
  const offsets = triangleOffsets || Array.from({ length: Math.floor(count / 3) }, (_, i) => i * 3);
  offsets.sort((a, b) => a - b);
  const IndexType = position.count > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexType(offsets.length * 3);
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(original.attributes)) geometry.setAttribute(name, attribute);
  geometry.morphAttributes = { ...original.morphAttributes };
  geometry.morphTargetsRelative = original.morphTargetsRelative;
  const bounds = new THREE.Box3();
  const vertex = new THREE.Vector3();
  let lastMaterial = -1, currentGroup = null;
  for (let triangle = 0; triangle < offsets.length; triangle++) {
    const offset = offsets[triangle];
    for (let corner = 0; corner < 3; corner++) {
      const id = sourceIndex ? sourceIndex.getX(offset + corner) : offset + corner;
      indices[triangle * 3 + corner] = id;
      bounds.expandByPoint(vertex.fromBufferAttribute(position, id));
    }
    if (original.groups.length) {
      const material = original.groups.find((group) => offset >= group.start && offset < group.start + group.count)?.materialIndex ?? 0;
      if (material !== lastMaterial) {
        currentGroup = { start: triangle * 3, count: 0, materialIndex: material };
        geometry.groups.push(currentGroup); lastMaterial = material;
      }
      currentGroup.count += 3;
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // BufferGeometry.computeBoundingBox() would include all SHARED positions,
  // including triangles omitted by our new index buffer. Bounds must instead
  // cover only the selected indices for correct framing and raycasting.
  geometry.boundingBox = bounds;
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  return geometry;
}

function finishPart(group, id, THREE, pose, info = DETAIL_INFO[id]) {
  const before = new THREE.Box3();
  for (const mesh of group.children) before.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix));
  if (before.isEmpty()) throw new Error(`Detail extraction produced an empty ${id} group.`);
  const center = before.getCenter(new THREE.Vector3());
  const translation = new THREE.Matrix4().makeTranslation(-center.x, -before.min.y, -center.z);
  for (const mesh of group.children) {
    mesh.matrix.premultiply(translation);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.matrixWorldNeedsUpdate = true;
  }
  const bounds = before.clone().applyMatrix4(translation);
  const size = bounds.getSize(new THREE.Vector3());
  const target = bounds.getCenter(new THREE.Vector3());
  const radius = size.length() * 0.5;
  const cameraDirection = new THREE.Vector3().fromArray(info.cameraDirection).normalize();
  const cameraFov = 35;
  const distance = radius / Math.sin(cameraFov * Math.PI / 360) * 1.12;
  const cameraPosition = target.clone().addScaledVector(cameraDirection, distance);
  const triangles = group.children.reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0);
  group.userData.detail = {
    id, title: info.title, description: info.description, limitation: info.limitation,
    units: 'metres', up: [0, 1, 0], pose,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    sourceBounds: { min: before.min.toArray(), max: before.max.toArray() },
    target: target.toArray(), size: size.toArray(), radius,
    cameraPosition: cameraPosition.toArray(), cameraDirection: cameraDirection.toArray(), cameraFov,
    minDistance: radius * 1.12, maxDistance: radius * 9,
    near: Math.max(0.001, radius / 100), far: Math.max(50, radius * 100),
    meshes: group.children.length, triangles,
    sourceMaterials: [...new Set(group.children.flatMap((mesh) =>
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => material.name)))],
    sharedAttributesAndMaterials: true,
  };
  if (id === 'cab') {
    const inside = new THREE.Box3();
    let interiorTriangles = 0;
    for (const mesh of group.children.filter((child) => !child.userData.isCabShell)) {
      inside.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix));
      interiorTriangles += mesh.geometry.index.count / 3;
    }
    if (inside.isEmpty()) throw new Error('Cab interior selection is empty.');
    const interiorTarget = inside.getCenter(new THREE.Vector3());
    const interiorSize = inside.getSize(new THREE.Vector3());
    const interiorRadius = interiorSize.length() / 2;
    const interiorDirection = new THREE.Vector3(1.25, .65, -1.1).normalize();
    group.userData.detail.interior = {
      bounds: { min: inside.min.toArray(), max: inside.max.toArray() },
      target: interiorTarget.toArray(), size: interiorSize.toArray(), radius: interiorRadius,
      cameraDirection: interiorDirection.toArray(), cameraFov,
      cameraPosition: interiorTarget.clone().addScaledVector(interiorDirection,
        interiorRadius / Math.sin(cameraFov * Math.PI / 360) * 1.12).toArray(),
      minDistance: interiorRadius * 1.12, maxDistance: interiorRadius * 9,
      near: Math.max(.001, interiorRadius / 100), far: Math.max(50, interiorRadius * 100),
      triangles: interiorTriangles,
    };
  }
  group.updateMatrixWorld(true);
}

/** Toggle only the newly extracted cabin shell; source model is unaffected. */
export function setCabInterior(group, enabled) {
  if (group?.userData?.detail?.id !== 'cab') throw new TypeError('Pass parts.cab to setCabInterior.');
  group.traverse((object) => {
    if (object.isMesh && object.userData.isCabShell) object.visible = !enabled;
  });
  group.userData.detail.interiorEnabled = Boolean(enabled);
  return enabled ? group.userData.detail.interior : group.userData.detail;
}

export function createDetailParts(model, THREE) {
  const scene = model?.scene || model;
  if (!scene?.traverse || !THREE?.BufferGeometry) throw new TypeError('Pass a GLTFLoader result or Object3D plus its THREE namespace.');
  const objects = [];
  scene.traverse((object) => objects.push(object));
  const byName = new Map(objects.map((object) => [canonicalName(object.name), object]));
  const requireNode = (name) => {
    const node = byName.get(name);
    if (!node) throw new Error(`Required excavator node missing: ${name}`);
    return node;
  };
  const slew = requireNode('02_SLEW_PIVOT');
  const undercarriage = requireNode('01_Undercarriage');
  const bucket = requireNode('05_BUCKET_PIVOT');
  const transforms = transformReader(model, scene, THREE);
  const inverseSlew = transforms.world(slew).invert();
  const inverseTracks = transforms.world(undercarriage).invert();
  const inverseBucket = transforms.world(bucket).invert();
  const parts = Object.fromEntries(Object.keys(DETAIL_INFO).map((id) => {
    const group = new THREE.Group(); group.name = `TN detail | ${id}`; return [id, group];
  }));
  const diagnostics = { omittedPlatformComponents: 0, omittedPlatformTriangles: 0 };
  function add(id, source, inverse, offsets, cabShell) {
    const geometry = selectedGeometry(source, offsets, THREE);
    const mesh = new THREE.Mesh(geometry, source.material);
    mesh.name = `TN detail ${id} | ${source.name}`;
    mesh.matrix.copy(inverse).multiply(transforms.world(source));
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.renderOrder = source.renderOrder;
    mesh.userData.sourceName = source.name;
    if (id === 'cab') {
      mesh.userData.isCabShell = Boolean(cabShell);
      mesh.userData.isCabInterior = !cabShell;
      mesh.name += cabShell ? ' | shell' : ' | interior';
    }
    parts[id].add(mesh);
  }
  function within(object, ancestor) {
    for (let cursor = object; cursor; cursor = cursor.parent) if (cursor === ancestor) return true;
    return false;
  }
  for (const source of objects.filter((object) => object.isMesh && object.geometry?.getAttribute('position'))) {
    if (source.isSkinnedMesh || source.isInstancedMesh) throw new Error('This detail extractor expects the rigid TN GLB, not skinned or instanced geometry.');
    if (within(source, undercarriage)) { add('tracks', source, inverseTracks); continue; }
    if (within(source, bucket)) { add('bucket', source, inverseBucket); continue; }
    // Both cylinder ends live under different rig parents. Select all parts
    // by the stable original name and bake each relative matrix separately.
    if (canonicalName(source.name).startsWith('Boom_cylinder_L_')) {
      add('hydraulics', source, inverseSlew); continue;
    }
    if (!isUppercarriagePrimitive(source, slew)) continue;
    const relative = inverseSlew.clone().multiply(transforms.world(source));
    const split = { cabShell: [], cabInterior: [], engine: [] };
    for (const component of connectedComponents(source.geometry, relative, THREE)) {
      const { min, max } = component.bounds;
      let id = null;
      // Boundaries verified against the source GLB and its two builders.
      // Entire connected components are retained: no clipped glass, open
      // body panels, partial chair upholstery, or cut cylinder surfaces.
      if (min.x >= 0.10 && max.z < 0.12 && min.y > 0.42) {
        const furniture = min.x >= .255 && max.x <= 1.58
          && min.z >= -1.29 && max.z <= -.25 && max.y <= 2.15;
        const floorMat = min.y > .60 && max.y < .68 && min.x > .2 && max.x < 1.75;
        id = furniture || floorMat ? 'cabInterior' : 'cabShell';
      }
      else if (max.x < 0.79 && min.y > 0.39) id = 'engine';
      if (id) split[id].push(...component.offsets);
      else {
        diagnostics.omittedPlatformComponents++;
        diagnostics.omittedPlatformTriangles += component.offsets.length;
      }
    }
    if (split.cabShell.length) add('cab', source, inverseSlew, split.cabShell, true);
    if (split.cabInterior.length) add('cab', source, inverseSlew, split.cabInterior, false);
    if (split.engine.length) add('engine', source, inverseSlew, split.engine);
  }
  for (const [id, group] of Object.entries(parts)) {
    finishPart(group, id, THREE, transforms.pose);
    if (id === 'cab' || id === 'engine') group.userData.detail.extraction = { ...diagnostics };
  }
  return parts;
}

/**
 * Two independent, close-up views of the original cabin furnishings.
 *
 * Seat: cushion, back, headrest/supports, armrests, suspension/base and buckle.
 * Controls: both molded consoles and complete joysticks, pedals/travel levers,
 * monitor housing, bezel, glass screen and buttons. Exterior shell and floor
 * mat are excluded. No geometry is generated or rearranged within either
 * view. Public metadata matches the existing details in userData.detail.
 *
 * The same source-resource ownership and rest-pose rules as createDetailParts
 * apply. Cache the returned groups; they share original PBR/vertex resources.
 */
export function createCabFocusParts(model, THREE) {
  const scene = model?.scene || model;
  if (!scene?.traverse || !THREE?.BufferGeometry) throw new TypeError('Pass a GLTFLoader result or Object3D plus its THREE namespace.');
  let slew = null;
  scene.traverse((object) => {
    if (canonicalName(object.name) === '02_SLEW_PIVOT') slew = object;
  });
  if (!slew) throw new Error('Required excavator node missing: 02_SLEW_PIVOT');
  const transforms = transformReader(model, scene, THREE);
  const inverseSlew = transforms.world(slew).invert();
  const parts = Object.fromEntries(Object.keys(CAB_FOCUS_INFO).map((id) => {
    const group = new THREE.Group();
    group.name = `TN cabin focus | ${id}`;
    return [id, group];
  }));
  const componentCounts = { seat: 0, controls: 0 };

  slew.traverse((source) => {
    if (!source.isMesh || !source.geometry?.getAttribute('position')) return;
    if (!isUppercarriagePrimitive(source, slew)) return;
    if (source.isSkinnedMesh || source.isInstancedMesh) throw new Error('Cab focus extraction expects rigid TN GLB geometry.');
    const relative = inverseSlew.clone().multiply(transforms.world(source));
    const split = { seat: [], controls: [] };
    for (const component of connectedComponents(source.geometry, relative, THREE)) {
      const { min, max } = component.bounds;
      // Cabin furniture envelope in slew-local glTF coordinates (+Y up).
      // This includes the headrest and complete monitor, and excludes every
      // shell/window component and the broad removable floor mat.
      const furniture = min.x >= .255 && max.x <= 1.58 && min.y > .42
        && min.z >= -1.29 && max.z <= -.25 && max.y <= 2.15;
      if (!furniture) continue;

      // Central seat body and suspension lie between the two consoles.
      // The padded armrests and outer buckle extend beyond that central
      // envelope and are retained by their separate, verified bounds.
      const seatCenter = max.x <= 1.10 && min.z >= -1.11 && max.z <= -.47;
      const paddedArmrest = min.x >= .45 && max.x <= .90 && min.y >= 1.15 && max.y <= 1.27;
      const seatBuckle = max.x <= .80 && min.z >= -1.17 && max.z <= -1.08
        && min.y >= 1.0 && max.y <= 1.12;
      const id = seatCenter || paddedArmrest || seatBuckle ? 'seat' : 'controls';
      split[id].push(...component.offsets);
      componentCounts[id]++;
    }
    for (const id of ['seat', 'controls']) {
      if (!split[id].length) continue;
      const mesh = new THREE.Mesh(selectedGeometry(source, split[id], THREE), source.material);
      mesh.name = `TN cabin focus ${id} | ${source.name}`;
      mesh.matrix.copy(relative);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.renderOrder = source.renderOrder;
      mesh.userData.sourceName = source.name;
      mesh.userData.cabFocusId = id;
      parts[id].add(mesh);
    }
  });
  for (const [id, group] of Object.entries(parts)) {
    finishPart(group, id, THREE, transforms.pose, CAB_FOCUS_INFO[id]);
    group.userData.detail.parentId = 'cab';
    group.userData.detail.components = componentCounts[id];
  }
  return parts;
}
