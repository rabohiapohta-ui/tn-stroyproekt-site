// Lossless transport compression. The original GLB remains a compatibility fallback.
export async function loadModel(loader,onProgress=()=>{}){
 const started=performance.now();
 const compressed=typeof DecompressionStream==='function';
 async function fetchBuffer(url,unzip){
  const response=await fetch(url);
  if(!response.ok)throw new Error(`Model HTTP ${response.status}`);
  const total=Number(response.headers.get('Content-Length'))||0;
  let loaded=0;const reader=response.body.getReader(),chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);loaded+=value.byteLength;onProgress(loaded,total);}
  const blob=new Blob(chunks);
  const buffer=unzip?await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():await blob.arrayBuffer();
  return {buffer,loaded};
 }
 let result,transport='glb';
 if(compressed){try{result=await fetchBuffer('./assets/tn-excavator.glb.gz?v=polish1',true);transport='gzip';}catch{onProgress(0,0);}}
 if(!result)result=await fetchBuffer('./assets/tn-excavator.glb?v=cab2',false);
 const downloaded=performance.now();
 const gltf=await loader.parseAsync(result.buffer,new URL('./',location.href).href);
 document.body.dataset.modelTransport=transport;
 document.body.dataset.modelBytes=String(result.loaded);
 document.body.dataset.modelDownloadMs=String(Math.round(downloaded-started));
 document.body.dataset.modelReadyMs=String(Math.round(performance.now()-started));
 return gltf;
}
