import { OrbitControls } from './vendor/addons/controls/OrbitControls.js';
import { createDetailParts, createCabFocusParts, setCabInterior } from './assets/parts.js?v=cab4';
import { detailContent } from './detail-content.js';

export function createDetailViewer({THREE,renderer,environment,gltf,mainOrbit,onOpen,onClose}){
  const dialog=document.getElementById('detail-dialog');
  const container=document.getElementById('detail-viewport');
  const originalContainer=document.getElementById('viewport');
  const parts={...createDetailParts(gltf,THREE),...createCabFocusParts(gltf,THREE)};
  const sequence=['cab','tracks','engine','hydraulics','bucket'];
  const scene=new THREE.Scene();scene.environment=environment;scene.environmentIntensity=.9;
  const camera=new THREE.PerspectiveCamera(36,1,.01,100);
  const orbit=new OrbitControls(camera,renderer.domElement);orbit.enabled=false;orbit.enableDamping=true;orbit.dampingFactor=.08;orbit.enablePan=false;orbit.maxPolarAngle=Math.PI*.92;
  const key=new THREE.DirectionalLight(0xffe7d1,2.5);key.position.set(6,9,-6);scene.add(key);
  const fill=new THREE.DirectionalLight(0xc1dce8,1.7);fill.position.set(-5,4,6);scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff,.3));
  const directions={cab:[1.3,.6,-1.8],seat:[1.5,.7,-1.8],controls:[1.5,1.1,-1.8],bucket:[-1.4,.7,-1.7],tracks:[1.5,.6,-2],engine:[-1.5,.9,1.5],hydraulics:[1,.3,-2]};
  let current=null,interior=false,dirty=true,opener=null;
  const bounds=()=>{const group=parts[current],box=new THREE.Box3();group.updateWorldMatrix(true,true);group.traverseVisible(o=>{if(o.isMesh)box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));});return box;};
  function fit(){
    const box=bounds(),center=box.getCenter(new THREE.Vector3());
    const dir=new THREE.Vector3(...directions[current]).normalize();
    const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),dir).normalize();
    const up=new THREE.Vector3().crossVectors(dir,right).normalize();
    const tanV=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanH=tanV*camera.aspect;
    let distance=0;
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const v=new THREE.Vector3(x,y,z).sub(center);
      distance=Math.max(distance,v.dot(dir)+Math.abs(v.dot(right))/tanH,v.dot(dir)+Math.abs(v.dot(up))/tanV);
    }
    distance*=1.13;
    camera.position.copy(center).addScaledVector(dir,distance);orbit.target.copy(center);
    const size=box.getSize(new THREE.Vector3()).length();orbit.minDistance=Math.max(.2,size*.24);orbit.maxDistance=size*5;camera.near=Math.max(.005,size/500);camera.far=Math.max(100,size*15);camera.updateProjectionMatrix();orbit.update();dirty=true;
  }
  function resize(refit=false){
    if(!dialog.open)return;
    const w=container.clientWidth,h=container.clientHeight;
    if(!w||!h)return;
    renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();if(refit&&current)fit();dirty=true;
  }
  const observer=new ResizeObserver(()=>resize(true));observer.observe(container);
  function openPart(id,source=null){
    if(!parts[id])return;
    if(!dialog.open){opener=source||document.activeElement;onOpen();mainOrbit.enabled=false;orbit.enabled=true;container.appendChild(renderer.domElement);dialog.showModal();}
    if(current){setCabInterior(parts.cab,false);scene.remove(parts[current]);}
    current=id;interior=false;scene.add(parts[id]);
    const info=detailContent[id];document.getElementById('detail-title').textContent=info.title;
    document.getElementById('detail-description').textContent=info.description;
    const dl=document.getElementById('detail-features');dl.replaceChildren();
    for(const [title,description] of info.features){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=title;dd.textContent=description;dl.append(dt,dd);}
    document.getElementById('detail-note').textContent=info.note||'';
    const inside=document.getElementById('cab-interior');inside.hidden=id!=='cab';inside.setAttribute('aria-pressed','false');inside.textContent='Внутри кабины';
    document.getElementById('cab-focus-tabs').hidden=!['cab','seat','controls'].includes(id);
    for(const button of dialog.querySelectorAll('[data-focus]'))button.setAttribute('aria-current',String(button.dataset.focus===id));
    document.getElementById('detail-counter').textContent=`${sequence.indexOf(['seat','controls'].includes(id)?'cab':id)+1} / ${sequence.length}`;
    dialog.scrollTop=0;resize();fit();
  }
  function close(){dialog.close();}
  dialog.addEventListener('close',()=>{
    if(current){setCabInterior(parts.cab,false);scene.remove(parts[current]);}
    current=null;interior=false;orbit.enabled=false;originalContainer.appendChild(renderer.domElement);mainOrbit.enabled=true;onClose();opener?.focus?.({preventScroll:true});
  });
  document.getElementById('detail-close').addEventListener('click',close);
  document.getElementById('detail-camera-reset').addEventListener('click',fit);
  document.getElementById('cab-interior').addEventListener('click',()=>{
    interior=!interior;setCabInterior(parts.cab,interior);
    const button=document.getElementById('cab-interior');button.setAttribute('aria-pressed',String(interior));button.textContent=interior?'Показать кабину целиком':'Внутри кабины';fit();
  });
  for(const button of document.querySelectorAll('[data-part]')){button.disabled=false;button.addEventListener('click',()=>openPart(button.dataset.part,button));}
  for(const button of dialog.querySelectorAll('[data-focus]'))button.addEventListener('click',()=>openPart(button.dataset.focus));
  function page(direction){const index=sequence.indexOf(['seat','controls'].includes(current)?'cab':current);openPart(sequence[(index+direction+sequence.length)%sequence.length]);}
  document.getElementById('detail-prev').addEventListener('click',()=>page(-1));
  document.getElementById('detail-next').addEventListener('click',()=>page(1));
  let swipe=null;
  const infoPanel=dialog.querySelector('.detail-info');
  infoPanel.addEventListener('pointerdown',e=>{swipe=e.pointerType==='touch'?{x:e.clientX,y:e.clientY}:null;});
  infoPanel.addEventListener('pointerup',e=>{if(swipe){const dx=e.clientX-swipe.x,dy=e.clientY-swipe.y;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)page(dx<0?1:-1);}swipe=null;});
  infoPanel.addEventListener('pointercancel',()=>{swipe=null;});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
  return {openPart,get isOpen(){return dialog.open;},get currentPart(){return current;},resize,render(){if(!dialog.open)return;const moved=orbit.update();if(dirty||moved){renderer.render(scene,camera);dirty=false;}},dispose(){observer.disconnect();orbit.dispose();}};
}
