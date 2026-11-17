import React,{useEffect,useRef,useState} from 'react';
import {Renderer,Stave,StaveNote,Voice,Formatter,Accidental,Annotation,StaveTie} from 'vexflow/bravura';
import {measuresFor,NAMES} from './music';

export default function Score({notes}) {
  const target = useRef(null);
  const [error,setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function draw() {
      await document.fonts.ready;
      if (cancelled || !target.current) return;
      target.current.replaceChildren();
      setError('');
      const measures = measuresFor(notes);
      try {
        measures.forEach((measure,measureIndex) => {
          const container = document.createElement('div');
          container.className = 'score-measure';
          container.setAttribute('aria-label',`${measureIndex + 1}마디`);
          target.current.append(container);
          const width = Math.max(740,measure.length * 60 + 130,measure.reduce((sum,note) => sum + Math.max(55,note.l.length * 17 + 15),130));
          const renderer = new Renderer(container,Renderer.Backends.SVG);
          renderer.resize(width,210);
          container.querySelector('svg').setAttribute('viewBox',`0 0 ${width} 210`);
          const context = renderer.getContext();
          const stave = new Stave(12,35,width - 24).addClef('treble');
          if (measureIndex === 0) stave.addTimeSignature('4/4');
          stave.setContext(context).draw();
          const tickables = measure.map(note => {
            const name = note.m === null ? 'B' : NAMES[note.m % 12];
            const octave = note.m === null ? 4 : Math.floor(note.m / 12) - 1;
            const duration = {16:'w',8:'h',4:'q',2:'8',1:'16'}[note.ticks];
            const staveNote = new StaveNote({clef:'treble',keys:[`${name[0].toLowerCase()}/${octave}`],duration:duration + (note.m === null ? 'r' : '')});
            if (name.includes('#')) staveNote.addModifier(new Accidental('#'),0);
            if (note.l) staveNote.addModifier(new Annotation(note.l).setFont('Arial',14).setVerticalJustification(Annotation.VerticalJustify.BOTTOM),0);
            return staveNote;
          });
          const voice = new Voice({numBeats:4,beatValue:4}).addTickables(tickables);
          new Formatter().joinVoices([voice]).format([voice],width - 155);
          voice.draw(context,stave);
          measure.forEach((note,index) => {
            if (note.tieStop) new StaveTie({firstNote:index > 0 ? tickables[index - 1] : undefined,lastNote:tickables[index],firstIndexes:[0],lastIndexes:[0]}).setContext(context).draw();
            if (note.tieStart && index === measure.length - 1) new StaveTie({firstNote:tickables[index],firstIndexes:[0],lastIndexes:[0]}).setContext(context).draw();
          });
        });
      } catch (failure) { setError(`악보 표시 오류: ${failure.message}`); }
    }
    draw();
    return () => { cancelled = true; };
  },[notes]);
  return <div className="score-paper">{!notes.length && <p>녹음하거나 음표를 추가해 악보를 만들어보세요.</p>}{error && <p role="alert">{error}</p>}<div ref={target}/></div>;
}
