import {jsPDF} from 'jspdf';
// Locked VexFlow distribution includes this font; no CDN request is made.
import {Bravura} from '../node_modules/vexflow/build/esm/src/fonts/bravura.js';

export async function scorePdf(title,tempo) {
  await document.fonts.ready;
  const pdf = new jsPDF({unit:'mm',format:'a4'});
  const heading = document.createElement('canvas');
  heading.width=1600; heading.height=220;
  const ctx=heading.getContext('2d');
  ctx.fillStyle='white'; ctx.fillRect(0,0,1600,220);
  ctx.fillStyle='#29232c'; ctx.textAlign='center'; ctx.font='bold 48px Arial';
  const text=title || '나의 노래';
  const scale=Math.min(1,1500/ctx.measureText(text).width);
  ctx.font=`bold ${48*scale}px Arial`; ctx.fillText(text,800,90);
  ctx.font='28px Arial'; ctx.fillText(`4/4   ·   BPM ${tempo}`,800,165);
  pdf.addImage(heading.toDataURL('image/png'),'PNG',14,12,182,25);
  let y=42;
  const svgs=[...document.querySelectorAll('.score-measure svg')];
  if(!svgs.length) throw Error('악보가 준비된 후 다시 눌러주세요.');
  for(const svg of svgs) {
    const view=svg.viewBox.baseVal;
    const source=svg.cloneNode(true);
    source.setAttribute('xmlns','http://www.w3.org/2000/svg');
    source.setAttribute('width',view.width); source.setAttribute('height',view.height);
    const style=document.createElementNS('http://www.w3.org/2000/svg','style');
    style.textContent=`@font-face {font-family:Bravura;src:url('${Bravura}')} text {font-family:Bravura,Arial,sans-serif}`;
    source.prepend(style);
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(source)],{type:'image/svg+xml;charset=utf-8'}));
    try {
      const img=new Image(); img.src=url; await img.decode();
      const canvas=document.createElement('canvas');
      canvas.width=view.width*2; canvas.height=view.height*2;
      const c=canvas.getContext('2d'); c.fillStyle='white'; c.fillRect(0,0,canvas.width,canvas.height);
      c.drawImage(img,0,0,canvas.width,canvas.height);
      const h=182*view.height/view.width;
      if(y+h>280) {pdf.addPage(); y=14;}
      pdf.addImage(canvas.toDataURL('image/png'),'PNG',14,y,182,h); y+=h+3;
    } finally { URL.revokeObjectURL(url); }
  }
  pdf.save('soriscore.pdf');
}
