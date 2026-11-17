export const SAMPLE = [{m:60,d:1,l:'오'},{m:62,d:1,l:'늘'},{m:64,d:1,l:'도'},{m:67,d:1,l:'행'},{m:65,d:1,l:'복'},{m:64,d:1,l:'해'}];
export const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const MAX_NOTES = 500;
export const noteName = midi => midi === null ? '쉼표' : NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
export const midiFreq = midi => 440 * 2 ** ((midi - 69) / 12);
export const hzMidi = frequency => Math.round(69 + 12 * Math.log2(frequency / 440));

export function validateProject(value) {
  if (!value || !Array.isArray(value.notes) || value.notes.length > MAX_NOTES) throw Error('음표는 최대 500개까지 불러올 수 있습니다.');
  const notes = value.notes.map(note => {
    if (!note || !(note.m === null || (Number.isInteger(note.m) && note.m >= 36 && note.m <= 96)) ||
      !Number.isFinite(note.d) || note.d < .25 || note.d > 16 || !Number.isInteger(note.d * 4) ||
      (note.l !== undefined && typeof note.l !== 'string')) throw Error('음정·길이·가사 형식을 확인해주세요.');
    return {m:note.m,d:note.d,l:(note.l || '').slice(0,80)};
  });
  return {title:typeof value.title === 'string' ? value.title.slice(0,100) : '나의 노래',
    tempo:Number.isFinite(value.tempo) ? Math.max(40,Math.min(240,Math.round(value.tempo))) : 120,notes};
}

export function detectPitch(data, sampleRate) {
  const stride = Math.max(1,Math.floor(sampleRate / 22050));
  const samples = Float32Array.from({length:Math.floor(data.length / stride)}, (_,index) => data[index * stride]);
  const energy = samples.reduce((sum,value) => sum + value * value,0) / samples.length;
  if (energy < .0001) return null;
  const rate = sampleRate / stride;
  const minimum = Math.floor(rate / 1100);
  const maximum = Math.min(Math.ceil(rate / 65),Math.floor(samples.length / 2) - 1);
  const windowSize = samples.length - maximum;
  const difference = new Float64Array(maximum + 1);
  let cumulative = 0;
  for (let lag = 1; lag <= maximum; lag++) {
    let sum = 0;
    for (let index = 0; index < windowSize; index++) {
      const delta = samples[index] - samples[index + lag];
      sum += delta * delta;
    }
    cumulative += sum;
    difference[lag] = cumulative ? sum * lag / cumulative : 1;
  }
  for (let lag = minimum; lag < maximum; lag++) {
    if (difference[lag] >= .15) continue;
    while (lag + 1 <= maximum && difference[lag + 1] < difference[lag]) lag++;
    const left = difference[lag - 1],center = difference[lag],right = difference[lag + 1] ?? center;
    const denominator = left - 2 * center + right;
    const adjustment = denominator ? Math.max(-1,Math.min(1,(left - right) / (2 * denominator))) : 0;
    return rate / (lag + adjustment);
  }
  return null;
}

export function reduceFrames(frames, tempo = 120, hop = .085) {
  const groups = [];
  for (const frame of frames) {
    const detected = frame.hz ? hzMidi(frame.hz) : null;
    const midi = detected !== null && detected >= 36 && detected <= 96 ? detected : null;
    const previous = groups.at(-1);
    if (previous && previous.m === midi && frame.t - previous.end < hop * 2.5) previous.end = frame.t;
    else groups.push({m:midi,start:frame.t,end:frame.t});
  }
  while (groups[0]?.m === null) groups.shift();
  while (groups.at(-1)?.m === null) groups.pop();
  return groups.filter(group => group.end - group.start + hop >= .12)
    .slice(0,MAX_NOTES).map(group => ({m:group.m,d:Math.max(.25,Math.min(16,Math.round((group.end - group.start + hop) * tempo / 60 * 4) / 4)),l:''}));
}

// Tempo is ambiguous for unaccompanied singing: prefer the candidate nearest
// the user's reference tempo when several subdivisions fit equally well.
export function estimateTempo(frames, reference = 120, hop = .085) {
  const onsets = [];
  let last = null, run = 0;
  for (let i = 0; i < frames.length; i++) {
    const midi = frames[i].hz ? hzMidi(frames[i].hz) : null;
    if (midi === last) run++;
    else { last = midi; run = 1; }
    if (midi !== null && run === 2) onsets.push(frames[i - 1].t);
  }
  const intervals = onsets.slice(1).map((t,i) => t - onsets[i]).filter(t => t >= .18 && t <= 3);
  if (intervals.length < 3) return null;
  let best = {bpm:reference,cost:Infinity};
  for (let bpm = 50; bpm <= 200; bpm++) {
    const cost = intervals.reduce((sum,t) => {
      const beats = t * bpm / 60;
      return sum + Math.min(...[.5,1,1.5,2,3,4].map(b => (beats-b)**2));
    },0) / intervals.length + .018 * Math.abs(Math.log2(bpm / reference));
    if (cost < best.cost) best = {bpm,cost};
  }
  return best.bpm;
}

export function measuresFor(notes) {
  const measures = [];
  let measure = [],used = 0;
  notes.forEach((note,index) => {
    let remaining = Math.round(note.d * 4), first = true;
    while (remaining > 0) {
      const available = Math.min(16 - used,remaining);
      const ticks = [16,8,4,2,1].find(value => value <= available);
      measure.push({...note,index,ticks,l:first ? note.l : '',tieStop:!first && note.m !== null,tieStart:remaining > ticks && note.m !== null});
      used += ticks;
      remaining -= ticks;
      first = false;
      if (used === 16) { measures.push(measure); measure = []; used = 0; }
    }
  });
  if (measure.length) {
    while (used < 16) {
      const ticks = [16,8,4,2,1].find(value => value <= 16 - used);
      measure.push({m:null,d:ticks / 4,ticks,l:'',padding:true});
      used += ticks;
    }
    measures.push(measure);
  }
  return measures;
}

const escapeXml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function musicXml(notes,title,tempo) {
  const types = {16:'whole',8:'half',4:'quarter',2:'eighth',1:'16th'};
  const measures = measuresFor(notes).map((measure,index) => `<measure number="${index + 1}">${index === 0 ? `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><sound tempo="${tempo}"/></direction>` : ''}${measure.map(note => {
    const name = note.m === null ? '' : NAMES[note.m % 12];
    const ties = `${note.tieStop ? '<tie type="stop"/>' : ''}${note.tieStart ? '<tie type="start"/>' : ''}`;
    const notations = `${note.tieStop ? '<tied type="stop"/>' : ''}${note.tieStart ? '<tied type="start"/>' : ''}`;
    return `<note>${note.m === null ? '<rest/>' : `<pitch><step>${name[0]}</step>${name.includes('#') ? '<alter>1</alter>' : ''}<octave>${Math.floor(note.m / 12) - 1}</octave></pitch>`}<duration>${note.ticks}</duration>${ties}<type>${types[note.ticks]}</type>${notations ? `<notations>${notations}</notations>` : ''}${note.l ? `<lyric><syllabic>single</syllabic><text>${escapeXml(note.l)}</text></lyric>` : ''}</note>`;
  }).join('')}</measure>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>${escapeXml(title)}</work-title></work><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}
