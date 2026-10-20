// Native animations, no scroll hijacking, no permanent render loop.
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const fine=matchMedia('(hover: hover) and (pointer: fine) and (min-width: 701px)');
const hero=document.querySelector('.hero-experience');
const environment=document.querySelector('.hero-environment');
const header=document.querySelector('.site-header');
const animations=new Set();
const ease='cubic-bezier(.16,1,.3,1)';
function animate(element,keyframes,options={}){
  if(!element||reduced.matches||typeof element.animate!=='function')return;
  const animation=element.animate(keyframes,{duration:760,easing:ease,...options});
  animations.add(animation);
  const clear=()=>animations.delete(animation);
  animation.addEventListener('finish',clear,{once:true});
  animation.addEventListener('cancel',clear,{once:true});
  return animation;
}
function enter(element,delay=0){
  animate(element,[{opacity:0,transform:'translate3d(0,26px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{delay,fill:'backwards'});
}
// The offer appears first. The scene never shifts the interactive model.
['.hero-copy .eyebrow','.hero h1','.hero-lead','.hero-actions','.hero-action-note','.hero-services'].forEach((selector,i)=>enter(document.querySelector(selector),i*65));
const candidates=[...document.querySelectorAll('.section-intro,.section-heading,.direction-links>a,.equipment-panel,.material-photo,.material-list,.works-list,.team-block>figure,.team-block>div,.case,.pdf-banner,.process-steps>li,.faq-layout>div:first-child,.faq-list,.contact-copy,.request-box,.project-proof>a')];
const seen=new WeakSet();
const observer=new IntersectionObserver(entries=>{
  const visible=entries.filter(entry=>entry.isIntersecting);
  visible.forEach((entry,i)=>{
    if(seen.has(entry.target))return;
    seen.add(entry.target);observer.unobserve(entry.target);
    enter(entry.target,Math.min(i,3)*75);
    entry.target.dataset.motionSeen='true';
  });
},{threshold:.08,rootMargin:'0px 0px -24px 0px'});
candidates.forEach(element=>observer.observe(element));
// A new category arrives as one composed panel; data and focus change immediately.
const panel=document.querySelector('#equipment-panel');
new MutationObserver(()=>{
  animate(panel.querySelector('.equipment-visual img'),[{opacity:.25,transform:'scale(1.045)'},{opacity:1,transform:'scale(1)'}],{duration:620});
  animate(panel.querySelector('.equipment-copy'),[{opacity:0,transform:'translate3d(18px,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:460});
}).observe(panel,{childList:true});
// Native details keeps its accessible toggle and keyboard interaction.
document.querySelectorAll('.material-list details,.works-list details,.faq-list details').forEach(details=>{
  details.addEventListener('toggle',()=>{
    if(details.open)[...details.children].filter(x=>x.tagName!=='SUMMARY').forEach((child,i)=>{
      animate(child,[{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:320,delay:i*35});
    });
  });
});
const sections=[...document.querySelectorAll('#equipment,#materials,#works,#cases,#contact')];
const navLinks=[...document.querySelectorAll('.main-nav a')];
const steps=[...document.querySelectorAll('.process-steps>li')];
let pointerX=0,pointerY=0,frame=0;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function update(){
  frame=0;
  const total=document.documentElement.scrollHeight-innerHeight;
  header.style.setProperty('--reading-progress',String(total>0?clamp(scrollY/total,0,1):0));
  const box=hero.getBoundingClientRect();
  if(fine.matches&&!reduced.matches&&box.bottom>0){
    environment.style.transform=`translate3d(${pointerX}px,${pointerY+clamp(-box.top*.055,-5,20)}px,0)`;
  }else if(reduced.matches||!fine.matches){environment.style.transform='none';}
  let current='';
  for(const section of sections){if(section.getBoundingClientRect().top<=innerHeight*.35)current='#'+section.id;}
  if(scrollY<hero.offsetHeight*.7)current='';
  for(const link of navLinks){if(link.getAttribute('href')===current)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
  steps.forEach(step=>{
    const rect=step.getBoundingClientRect();
    const index=steps.indexOf(step);
    const offset=innerWidth>700?index*42:0;
    const value=reduced.matches?1:clamp((innerHeight*.85-rect.top-offset)/180,0,1);
    step.style.setProperty('--step-progress',String(value));
  });
}
function schedule(){if(!frame)frame=requestAnimationFrame(update);}
window.addEventListener('scroll',schedule,{passive:true});
window.addEventListener('resize',schedule,{passive:true});
hero.addEventListener('pointermove',event=>{
  if(!fine.matches||reduced.matches||event.buttons)return;
  const rect=hero.getBoundingClientRect();
  pointerX=(event.clientX/innerWidth-.5)*14;
  pointerY=((event.clientY-rect.top)/rect.height-.5)*8;
  schedule();
},{passive:true});
hero.addEventListener('pointerleave',()=>{pointerX=pointerY=0;schedule();});
reduced.addEventListener('change',()=>{if(reduced.matches)for(const animation of animations)animation.cancel();schedule();});
fine.addEventListener('change',schedule);
if(typeof ResizeObserver!=='undefined')new ResizeObserver(schedule).observe(document.body);
window.addEventListener('load',schedule,{once:true});
schedule();
