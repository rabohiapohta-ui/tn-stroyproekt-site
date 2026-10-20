import * as THREE from 'three';
import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/addons/environments/RoomEnvironment.js';
import { createExcavatorRig } from './assets/excavator-rig.js';
import { createDetailViewer } from './detail-view.js?v=cab4';
import { createJointLoops } from './assets/joint-loops.js';
import { initialView } from './initial-view.js?v=polish4';
import { createDemoCycle } from './assets/demo-cycle.js?v=responsive1';
import { loadModel } from './assets/load-model.js';

const viewport=document.getElementById('viewport');
const loading=document.getElementById('loading');
const loadLabel=document.getElementById('loading-label');
const progress=document.getElementById('load-progress');
const play=document.getElementById('play');
const playLabel=document.getElementById('play-label');
const status=document.getElementById('pose-status');
const partTip=document.getElementById('part-tip');
const controls=Object.fromEntries(['slew','boom','stick','bucket'].map(id=>[id,document.getElementById(id)]));
const hotspotLayer=document.getElementById('hotspots');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const zero={slew:0,boom:0,stick:0,bucket:0};
const limits={slew:[-180,180],boom:[-15,0],stick:[0,15],bucket:[0,30]};
const actions={slew:[35,-35,0],boom:[-15,0],stick:[15,0],bucket:[30,0]};
const actionIndex={slew:0,boom:0,stick:0,bucket:0};
const names={slew:'Платформа',boom:'Стрела',stick:'Рукоять',bucket:'Ковш'};
const anchors={
  slew:{node:'02_SLEW_PIVOT',point:[-1.7,.85,-1.32]},
  boom:{node:'03_BOOM_PIVOT',point:[1.55,2.12,-.285]},
  stick:{node:'04_STICK_PIVOT',point:[.28,-1.6,-.2515]},
  bucket:{node:'05_BUCKET_PIVOT',point:[.27,-.65,-.802]}
};
let renderer,scene,camera,orbit,model,playing=false,rig,elapsed=0,needsRender=true,motion=null,activeJoint=null,detailViewer=null,cameraMotion=null,loops=null,demo=null,awakened=false;
const clock=new THREE.Clock();
const home={camera:new THREE.Vector3(...initialView.position),target:new THREE.Vector3(...initialView.target)};
function fail(message,error){loading.hidden=true;hotspotLayer.hidden=true;const node=document.getElementById('error');node.hidden=false;node.textContent=message;console.error(error);}
function resetCamera(){cameraMotion=null;camera.up.set(0,1,0);orbit.maxPolarAngle=Math.PI/2-.04;camera.position.copy(viewport.clientWidth<=680?new THREE.Vector3(11.2,4,-4.5):home.camera);orbit.target.copy(home.target);orbit.update();for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed','false');needsRender=true;}
function setPlaying(value){playing=value;playLabel.textContent=value?'Остановить движение':'Оживить экскаватор';play.setAttribute('aria-label',playLabel.textContent);play.setAttribute('aria-pressed',String(value));}
function syncLoops(){for(const [id,b] of Object.entries(controls)){const active=loops?.isActive(id)||false;b.classList.toggle('is-active',active);b.setAttribute('aria-pressed',String(active));b.setAttribute('aria-label',`${names[id]} — ${active?'остановить':'включить'} движение`);}setPlaying(!!loops?.hasActive||!!demo?.active);}
function stopLoops(){loops?.stopAll();demo?.stop();syncLoops();}
function toggleAll(){if(!loops)return;awakened=true;motion=null;if(loops.hasActive||demo?.active)stopLoops();else{demo.start();syncLoops();}status.textContent=playing?'Нажмите на кабину или другую деталь, чтобы заглянуть ближе':'Движение на паузе · нажмите ▶, чтобы продолжить';document.querySelector('.live-hint').textContent='Нажмите на деталь';}
function tuneMaterials(root){
  const settings={'V2 | graphite painted steel':[.2,.5,0,.2],'V2 | orange panels':[.2,.4,.025,.17],'V2 | bucket steel':[.95,.48,0,.1],'V3 | worn crawler steel':[.85,.32,0,.06]};
  const seen=new Set();root.traverse(o=>{if(!o.isMesh)return;for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(seen.has(m))continue;seen.add(m);const v=settings[m.name];if(v){m.metalness=v[0];m.envMap=scene.environment;m.envMapIntensity=v[1];m.clearcoat=v[2];m.clearcoatRoughness=.55;m.roughness=1;m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\nroughnessFactor = min(1.0, roughnessFactor + ${v[3].toFixed(2)});`);};m.customProgramCacheKey=()=>`tn-matte-${v[3]}`;m.needsUpdate=true;}else if(m.name==='V2 | hydraulic chrome'){m.envMap=scene.environment;m.envMapIntensity=.65;m.roughness=.22;}}});
}

function setActive(id){activeJoint=id;for(const [key,button] of Object.entries(controls))button.classList.toggle('is-active',key===id);}
function transitionTo(target,{joint=null,duration=1.45,onComplete=null}={}){
  stopLoops();setActive(joint);
  motion={from:rig.getPose(),to:{...rig.getPose(),...target},time:0,duration:reducedMotion.matches?.28:duration,onComplete};needsRender=true;
}
function triggerJoint(id){
  if(!loops)return;partTip.hidden=true;awakened=true;motion=null;demo?.stop();
  const active=loops.toggle(id);syncLoops();
  status.textContent=`${names[id]}: ${active?'движение повторяется · нажмите ещё раз, чтобы остановить':'движение остановлено'}`;
}
function updateHotspots(){
  if(!model)return;
  const width=viewport.clientWidth,height=viewport.clientHeight;
  model.updateWorldMatrix(true,true);
  const placed=[];
  for(const [id,anchor] of Object.entries(anchors)){
    const point=new THREE.Vector3(...anchor.point);
    if(anchor.object.worldToLocal(camera.position.clone()).z>0)point.z=-point.z;
    const world=anchor.object.localToWorld(point);
    const projected=world.clone().project(camera);
    const button=controls[id],line=document.getElementById(`line-${id}`);
    const visible=projected.z>-1&&projected.z<1;
    button.hidden=!visible;button.style.visibility=visible?'visible':'hidden';line.style.display=visible?'':'none';
    if(!visible)continue;
    const rawX=(projected.x*.5+.5)*width,rawY=(-projected.y*.5+.5)*height;
    let x=Math.max(37,Math.min(width-37,rawX)),y=Math.max(105,Math.min(height-32,rawY));
    for(let i=0;i<6;i++)for(const other of placed){const dx=x-other.x,dy=y-other.y,d=Math.hypot(dx,dy);if(d<62){const angle=d>.01?Math.atan2(dy,dx):Math.PI/2;x+=Math.cos(angle)*(62-d);y+=Math.sin(angle)*(62-d);x=Math.max(37,Math.min(width-37,x));y=Math.max(105,Math.min(height-32,y));}}
    placed.push({x,y});button.style.transform=`translate(${x}px,${y}px)`;
    // Keep hover/focus labels within the stage at narrow widths.
    const tip=button.querySelector('.hotspot-tip');tip.style.left=x<110?'0':x>width-110?'100%':'50%';tip.style.translate=x<110?'50%':x>width-110?'-50%':'0';
    line.setAttribute('x1',rawX);line.setAttribute('y1',rawY);line.setAttribute('x2',x);line.setAttribute('y2',y);line.style.opacity=Math.hypot(x-rawX,y-rawY)>14?'.65':'0';
  }
}
try{
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;viewport.appendChild(renderer.domElement);
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(34,1,.1,100);
  orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.dampingFactor=.07;orbit.minDistance=5;orbit.maxDistance=27;orbit.maxPolarAngle=Math.PI/2-.04;orbit.enablePan=false;orbit.zoomSpeed=.7;orbit.rotateSpeed=.6;
  resetCamera();
  const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();const env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.72;room.dispose();pmrem.dispose();
  const key=new THREE.DirectionalLight(0xffead9,2.2);key.position.set(0,9,-5);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-9;key.shadow.camera.right=9;key.shadow.camera.top=8;key.shadow.camera.bottom=-8;key.shadow.camera.far=26;key.shadow.normalBias=.018;key.shadow.bias=-.0003;key.shadow.radius=2.5;scene.add(key);key.target.position.set(1,1,0);scene.add(key.target);
  const fill=new THREE.DirectionalLight(0xb6d2e4,.65);fill.position.set(-6,4,8);scene.add(fill);
  const frontal=new THREE.DirectionalLight(0xe5e5de,1.4);frontal.position.set(6,5,-9);scene.add(frontal);
  const rim=new THREE.DirectionalLight(0xffc997,1.3);rim.position.set(-3,5,4);scene.add(rim);
  const low=new THREE.PointLight(0xffb866,3.5,12,2);low.position.set(4,.65,-5);scene.add(low);
  scene.fog=new THREE.Fog(0x1b2327,18,42);
  // Transparent shadow catcher joins the 3D machine to the full-width construction scene.
  const floorMaterial=new THREE.ShadowMaterial({color:0x03090e,opacity:.32,fog:false});
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(200,200),floorMaterial);plane.rotation.x=-Math.PI/2;plane.position.y=-.017;plane.receiveShadow=true;scene.add(plane);
  let portraitMode=null;const resize=()=>{if(detailViewer?.isOpen){detailViewer.resize(true);return;}const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);if(portraitMode!==(w<=680)){portraitMode=w<=680;resetCamera();}camera.aspect=w/h;const top=24,bottom=105,contentH=Math.max(220,h-top-bottom);camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(17))*Math.max(1,(w<=680?initialView.portraitFraming*1.12:1.25)/(w/contentH))*h/contentH));camera.setViewOffset(w,h,w<=680?-25:0,(bottom-top)/2,w,h);camera.updateProjectionMatrix();needsRender=true;};new ResizeObserver(resize).observe(viewport);resize();
  Promise.all([
    loadModel(new GLTFLoader(),(loaded,total)=>{if(total){const v=Math.round(loaded/total*100);progress.value=v;loadLabel.textContent=v<100?`Загружаем экскаватор… ${v}%`:'Подготавливаем модель…';}}),
    fetch('./assets/excavator-rig-data.json').then(response=>{if(!response.ok)throw new Error('Rig data unavailable');return response.json();})
  ]).then(([gltf,rigData])=>{
    model=gltf.scene;tuneMaterials(model);model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material?.transmission){o.castShadow=false;}}});scene.add(model);
    rig=createExcavatorRig(model,THREE,rigData);loops=createJointLoops(rig,{fadeInSeconds:.12,periods:{slew:7,boom:3,stick:2.8,bucket:2.6}});demo=createDemoCycle(rig);
    for(const [id,anchor] of Object.entries(anchors)){anchor.object=model.getObjectByName(anchor.node);if(!anchor.object)throw new Error('Missing hotspot anchor: '+id);controls[id].disabled=false;}
    detailViewer=createDetailViewer({THREE,renderer,environment:scene.environment,gltf,mainOrbit:orbit,onOpen(){partTip.hidden=true;motion=null;cameraMotion=null;stopLoops();setActive(null);status.textContent='Движение на паузе · обзор детали';},onClose(){resize();needsRender=true;}});
    for(const button of document.querySelectorAll('[data-view]'))button.disabled=false;
    hotspotLayer.hidden=false;needsRender=true;
    loading.hidden=true;play.disabled=false;document.getElementById('camera-reset').disabled=false;document.getElementById('pose-reset').disabled=false;syncLoops();resetCamera();updateHotspots();renderer.render(scene,camera);document.body.classList.add('ready');setTimeout(()=>{if(!awakened&&!detailViewer?.isOpen&&!reducedMotion.matches)toggleAll();},100);
    reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)stopLoops();});
    window.tnViewer={scene,model,camera,renderer,orbit,get playing(){return playing;},get loops(){return loops;},get demo(){return demo;},get rig(){return rig;},get motion(){return motion;},get activeJoint(){return activeJoint;},get details(){return detailViewer;}};
  }).catch(error=>fail('Не удалось загрузить модель. Обновите страницу и попробуйте ещё раз.',error));
  renderer.setAnimationLoop(()=>{
    const delta=Math.min(clock.getDelta(),.25);
    if(document.hidden||window.tnStageVisible===false&&!detailViewer?.isOpen)return;
    if(detailViewer?.isOpen){detailViewer.render();return;}
    if(cameraMotion){cameraMotion.time+=delta;const t=Math.min(cameraMotion.time/.8,1),e=t*t*(3-2*t);camera.position.lerpVectors(cameraMotion.from,cameraMotion.to,e);orbit.target.lerpVectors(cameraMotion.targetFrom,cameraMotion.targetTo,e);needsRender=true;if(t===1)cameraMotion=null;}
    if(demo?.active){const result=demo.update(delta);needsRender=true;if(!result.ok){stopLoops();status.textContent='Движение остановлено';}}
    else if(loops?.hasActive){const result=loops.update(delta);needsRender=true;if(!result.ok){stopLoops();status.textContent='Движение остановлено';}}
    else if(motion&&rig){
      motion.time+=delta;
      const fraction=Math.min(motion.time/motion.duration,1),ease=fraction*fraction*(3-2*fraction);
      const pose=Object.fromEntries(Object.keys(zero).map(id=>[id,THREE.MathUtils.lerp(motion.from[id],motion.to[id],ease)]));
      const result=rig.setPose(pose);needsRender=true;
      if(!result.ok){motion=null;setActive(null);status.textContent='Достигнут предел движения механизма.';}
      else if(fraction===1){const done=motion.onComplete;motion=null;setActive(null);status.textContent='Нажмите на любую точку, чтобы продолжить';done?.();}
    }
    const moved=orbit.update();
    if(needsRender||moved){updateHotspots();renderer.render(scene,camera);needsRender=false;}
  });
  document.getElementById('camera-reset').addEventListener('click',resetCamera);
  play.addEventListener('click',()=>{partTip.hidden=true;toggleAll();});
  document.querySelector('.live-hint').addEventListener('click',()=>{if(detailViewer)detailViewer.openPart('cab',document.querySelector('.live-hint'));});
  for(const [id,button] of Object.entries(controls)){
    button.addEventListener('click',()=>triggerJoint(id));
    button.addEventListener('keydown',event=>{
      if(!rig||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();
      const sign=['ArrowRight','ArrowUp'].includes(event.key)?1:-1;
      const step=id==='slew'?5:id==='bucket'?3:1;
      const current=motion?.to[id]??rig.getPose()[id];
      const target=THREE.MathUtils.clamp(current+sign*step*(id==='boom'?-1:1),...limits[id]);
      transitionTo({[id]:target},{joint:id,duration:.25});status.textContent=`${names[id]}: ${Math.round(Math.abs(target))}°`;
    });
  }
  document.getElementById('pose-reset').addEventListener('click',()=>{if(!rig)return;for(const id of Object.keys(actionIndex))actionIndex[id]=0;transitionTo(zero,{duration:1});status.textContent='Возвращаем исходное положение';});

  const cameraViews={side:{position:[1.79,3.3,-14.5],target:[1.79,2.3,0]},rear:{position:[-14,3.4,0.01],target:[1.2,2.15,0]},front:{position:[16.5,3.5,-.05],target:[1.45,2.2,0]},top:{position:[1.79,17,-.04],target:[1.79,2.3,0]}};
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{
    const id=button.dataset.view,v=cameraViews[id];cameraMotion=null;camera.up.set(0,1,0);orbit.maxPolarAngle=Math.PI/2-.04;
    const target=new THREE.Vector3(...v.target),position=new THREE.Vector3(...v.position);
    for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b===button));
    if(reducedMotion.matches){camera.position.copy(position);orbit.target.copy(target);needsRender=true;return;}
    cameraMotion={from:camera.position.clone(),to:position,targetFrom:orbit.target.clone(),targetTo:target,time:0};
  });
  orbit.addEventListener('start',()=>{cameraMotion=null;partTip.hidden=true;});
  const partNames={cab:'Кабина',bucket:'Ковш',engine:'Моторный отсек',tracks:'Ходовая часть',hydraulics:'Гидравлика'};
  let selectedPart=null;
  function showPart(part,event,touch=false){selectedPart=part;partTip.textContent=partNames[part]+' · Открыть';partTip.hidden=false;partTip.classList.toggle('touch-tip',touch);const r=viewport.getBoundingClientRect();partTip.style.left=Math.max(90,Math.min(r.width-90,event.clientX-r.left))+'px';partTip.style.top=Math.max(40,event.clientY-r.top-42)+'px';}
  partTip.addEventListener('click',()=>{if(selectedPart)detailViewer.openPart(selectedPart,renderer.domElement);});
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let pointerDown=null;const pressedPointers=new Set();
  const pick=event=>{
    if(!model||detailViewer?.isOpen)return null;
    const r=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
    raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObject(model,true);return hits.length?{part:classifyExcavatorHit(hits[0])}:null;
  };
  renderer.domElement.addEventListener('pointerdown',event=>{pressedPointers.add(event.pointerId);pointerDown=pressedPointers.size===1?{x:event.clientX,y:event.clientY,time:performance.now(),id:event.pointerId}:null;});
  renderer.domElement.addEventListener('pointerup',event=>{
    pressedPointers.delete(event.pointerId);
    if(pointerDown&&event.pointerId===pointerDown.id&&Math.hypot(event.clientX-pointerDown.x,event.clientY-pointerDown.y)<6&&performance.now()-pointerDown.time<650){const hit=pick(event);if(hit){if(hit.part){if(event.pointerType==='touch'){stopLoops();showPart(hit.part,event,true);}else detailViewer.openPart(hit.part,renderer.domElement);}else{partTip.hidden=true;toggleAll();}}}
    pointerDown=null;
  });
  renderer.domElement.addEventListener('pointercancel',event=>{pressedPointers.delete(event.pointerId);pointerDown=null;});
  renderer.domElement.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'&&!pointerDown&&!detailViewer?.isOpen){const hit=pick(event);renderer.domElement.style.cursor=hit?'pointer':'grab';if(hit?.part)showPart(hit.part,event);else partTip.hidden=true;}});
renderer.domElement.addEventListener('pointerleave',()=>{if(!partTip.classList.contains('touch-tip'))partTip.hidden=true;});
function classifyExcavatorHit(hit) {
  const ancestors = [];
  for (let node = hit.object; node; node = node.parent) ancestors.push(node);
  const name = node => node.userData?.name || node.name || '';
  const named = value => ancestors.find(node => name(node) === value);
  if (named('01_Undercarriage')) return 'tracks';
  if (ancestors.some(node => name(node).includes('cylinder'))) return 'hydraulics';
  if (named('05_BUCKET_PIVOT')) return 'bucket';
  if (ancestors.some(node => /Bucket[ _](linkage|rocker|connecting)/.test(name(node)))) return 'hydraulics';
  // Never label an arm surface as part of the cabin or engine just because
  // its current world position projects into the same spatial box.
  if (named('03_BOOM_PIVOT') || named('04_STICK_PIVOT')) return null;
  const slew = named('02_SLEW_PIVOT');
  if (!slew) return null;
  const p = slew.worldToLocal(hit.point.clone());
  const inside = (a,b) => p.x>=a[0] && p.x<=b[0] && p.y>=a[1] && p.y<=b[1] && p.z>=a[2] && p.z<=b[2];
  if (inside([.10,.435,-1.76],[1.94,2.625,.04])) return 'cab';
  if (inside([-2.72,.40,-1.49],[.095,2.29,1.45])) return 'engine';
  if (inside([.095,.40,.06],[.81,1.64,1.41])) return 'engine';
  return null;
}
  document.addEventListener('visibilitychange',()=>{clock.getDelta();needsRender=true;});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();stopLoops();fail('Просмотр 3D был остановлен устройством. Обновите страницу, чтобы продолжить.');});
}catch(error){fail('Устройство не смогло открыть 3D-просмотр. Попробуйте современный браузер с поддержкой WebGL.',error);}
