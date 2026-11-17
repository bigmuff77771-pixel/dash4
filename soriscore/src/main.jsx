import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Score from './Score';
import {SAMPLE,MAX_NOTES,noteName,midiFreq,detectPitch,reduceFrames,estimateTempo,validateProject,musicXml} from './music';
import './style.css';

function initialProject() {
  try {
    const saved = localStorage.getItem('soriscore-project');
    if (saved) return validateProject(JSON.parse(saved));
    const legacy = localStorage.getItem('soriscore-notes');
    if (legacy) return validateProject({title:localStorage.getItem('soriscore-title'),notes:JSON.parse(legacy)});
  } catch {}
  return {title:'나의 노래',notes:SAMPLE,tempo:120};
}

function download(name,content,type) {
  const anchor = document.createElement('a');
  const url = URL.createObjectURL(new Blob([content],{type}));
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

function App() {
  const [project,setProject] = useState(initialProject);
  const {title,notes,tempo} = project;
  const [status,setStatus] = useState('준비됨 · 반주 없이 한 음씩 선명하게 불러주세요.');
  const [recording,setRecording] = useState(false);
  const [busy,setBusy] = useState(false);
  const [starting,setStarting] = useState(false);
  const [lyrics,setLyrics] = useState('');
  const [playing,setPlaying] = useState(false);
  const [storageError,setStorageError] = useState(false);
  const runtime = useRef(null);
  const playback = useRef(null);
  const startingRef = useRef(false);
  const lastFrames = useRef([]);
  const [suggestedTempo,setSuggestedTempo] = useState(null);
  const setNotes = update => setProject(previous => ({...previous,notes:typeof update === 'function' ? update(previous.notes) : update}));
  const locked = recording || busy || starting;
  useEffect(() => {
    try { localStorage.setItem('soriscore-project',JSON.stringify(project)); setStorageError(false); }
    catch { setStorageError(true); }
  },[project]);
  useEffect(() => () => {
    const active = runtime.current;
    if (active) { clearInterval(active.timer); clearTimeout(active.limit); active.stream.getTracks().forEach(track => track.stop()); active.ac.close(); }
    if (playback.current) { clearTimeout(playback.current.timer); playback.current.ac.close(); }
  },[]);

  function stopPlayback() {
    if (playback.current) { clearTimeout(playback.current.timer); playback.current.ac.close(); playback.current = null; }
    setPlaying(false);
  }
  async function start() {
    if (startingRef.current || runtime.current) return;
    startingRef.current = true;
    setStarting(true);
    setStatus('마이크 권한을 요청했습니다. 브라우저의 마이크 허용 안내를 확인해주세요.');
    stopPlayback();
    let stream,ac;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('이 브라우저는 마이크 녹음을 지원하지 않습니다. HTTPS 주소에서 접속해주세요.');
      stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      ac = new (window.AudioContext || window.webkitAudioContext)();
      await ac.resume();
      const source = ac.createMediaStreamSource(stream),analyser = ac.createAnalyser();
      analyser.fftSize = 4096;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize),frames = [],begin = performance.now();
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        frames.push({t:(performance.now() - begin) / 1000,hz:detectPitch(data,ac.sampleRate)});
      },85);
      runtime.current = {stream,ac,timer,frames,tempo,limit:setTimeout(stop,240000)};
      setRecording(true);
      setStatus('녹음 중 · 최대 4분. 끝나면 녹음 종료를 눌러주세요.');
    } catch (failure) {
      stream?.getTracks().forEach(track => track.stop());
      if (ac) await ac.close();
      setStatus(failure.name === 'NotAllowedError' ? '마이크 권한이 거부되었습니다. 주소창의 사이트 권한에서 마이크를 허용해주세요.' : `마이크 사용 불가: ${failure.message}`);
    } finally { startingRef.current = false; setStarting(false); }
  }
  async function stop() {
    const active = runtime.current;
    if (!active) return;
    runtime.current = null;
    clearInterval(active.timer);
    clearTimeout(active.limit);
    active.stream.getTracks().forEach(track => track.stop());
    setRecording(false);
    await active.ac.close();
    const extracted = reduceFrames(active.frames,active.tempo);
    lastFrames.current = active.frames;
    setSuggestedTempo(estimateTempo(active.frames,active.tempo));
    if (extracted.some(note => note.m !== null)) { setNotes(extracted); setStatus(`${extracted.length}개 음표·쉼표 추출 완료. 음정·길이·가사를 확인해주세요.`); }
    else setStatus('음정을 찾지 못했습니다. 조용한 곳에서 다시 녹음해주세요.');
  }
  async function importAudio(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { setStatus('50MB 이하 오디오 파일을 선택해주세요.'); return; }
    stopPlayback();
    setBusy(true);
    setStatus('파일 음정 분석 중…');
    let ac;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const audio = await ac.decodeAudioData(await file.arrayBuffer());
      const channel = new Float32Array(audio.length);
      for (let index = 0; index < audio.numberOfChannels; index++) {
        const input = audio.getChannelData(index);
        for (let sample = 0; sample < channel.length; sample++) channel[sample] += input[sample] / audio.numberOfChannels;
      }
      const frames = [],hop = Math.round(audio.sampleRate * .085),size = 4096;
      const limit = Math.min(channel.length,audio.sampleRate * 240);
      for (let index = 0; index + size <= limit; index += hop) {
        frames.push({t:index / audio.sampleRate,hz:detectPitch(channel.subarray(index,index + size),audio.sampleRate)});
        if (frames.length % 25 === 0) await new Promise(resolve => setTimeout(resolve,0));
      }
      const extracted = reduceFrames(frames,tempo);
      lastFrames.current = frames;
      setSuggestedTempo(estimateTempo(frames,tempo));
      if (extracted.some(note => note.m !== null)) { setNotes(extracted); setStatus(`${extracted.length}개 음표·쉼표 분석 완료${audio.duration > 240 ? ' (처음 4분만 분석)' : ''}.`); }
      else setStatus('음정을 찾지 못했습니다. 반주 없는 음성 파일을 사용해주세요.');
    } catch { setStatus('파일을 해석하지 못했습니다. WAV 또는 브라우저가 지원하는 오디오를 선택해주세요.'); }
    finally { if (ac) await ac.close(); setBusy(false); }
  }
  async function importProject(file) {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw Error('1MB 이하 JSON 프로젝트를 선택해주세요.');
      const imported = validateProject(JSON.parse(await file.text()));
      stopPlayback();
      setProject(imported);
      lastFrames.current = []; setSuggestedTempo(null);
      setStatus('프로젝트를 불러왔습니다.');
    } catch (failure) { setStatus(`프로젝트를 불러오지 못했습니다: ${failure.message}`); }
  }
  function applyLyrics() {
    const text = lyrics.trim();
    const words = /\s/.test(text) ? text.split(/\s+/) : Array.from(text);
    let index = 0;
    setNotes(previous => previous.map(note => ({...note,l:note.m === null ? '' : (words[index++] || '').slice(0,80)})));
    setStatus('가사 배치 완료. 쉼표는 건너뛰며, 각 음표에서도 수정할 수 있습니다.');
  }
  async function play() {
    if (playing) { stopPlayback(); return; }
    let ac;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      await ac.resume();
      setPlaying(true);
      let time = ac.currentTime + .1;
      for (const note of notes) {
        const duration = note.d * 60 / tempo;
        if (note.m !== null) {
          const oscillator = ac.createOscillator(),gain = ac.createGain();
          oscillator.frequency.value = midiFreq(note.m);
          gain.gain.setValueAtTime(0,time);
          gain.gain.linearRampToValueAtTime(.15,time + Math.min(.02,duration / 4));
          gain.gain.setValueAtTime(.15,time + duration * .7);
          gain.gain.linearRampToValueAtTime(0,time + duration);
          oscillator.connect(gain).connect(ac.destination);
          oscillator.start(time);
          oscillator.stop(time + duration);
        }
        time += duration;
      }
      playback.current = {ac,timer:setTimeout(stopPlayback,(time - ac.currentTime) * 1000 + 100)};
    } catch { if (ac) await ac.close(); setPlaying(false); setStatus('오디오 재생을 시작하지 못했습니다. 브라우저 오디오 권한을 확인해주세요.'); }
  }
  const edit = (index,change) => setNotes(previous => previous.map((note,current) => current === index ? {...note,...change} : note));
  return <main>
    <header><div className="brand"><span>♫</span><div><b>소리악보</b><small>SoriScore · 나만의 채보 스튜디오</small></div></div><span className="tag">무료 · 외부 AI API 없음</span></header>
    <section className="hero"><h1>노래를 부르면, 악보가 됩니다.</h1><p>멜로디 녹음 → 음정 추출 → 가사 입력 → 악보 편집 → PDF 출력</p>
      <div className="actions"><button className="primary" onClick={recording ? stop : start} disabled={busy || starting}>{recording ? '■ 녹음 종료 및 분석' : starting ? '마이크 연결 중…' : '● 마이크 녹음 시작'}</button>
        <label className={`upload ${locked ? 'disabled' : ''}`}>↥ 오디오 파일 업로드<input aria-label="오디오 파일 업로드" type="file" accept="audio/*,.wav,.mp3,.m4a" disabled={locked} onChange={event => { importAudio(event.target.files[0]); event.target.value = ''; }}/></label></div>
      <div className="status" role="status" aria-live="polite">{status}</div>
    </section>
    <section className="panel"><div className="panel-head"><h2>악보 편집</h2><div className="actions small">
      <button onClick={play} disabled={locked || !notes.length}>{playing ? '■ 재생 정지' : '▶ 재생'}</button>
      <button onClick={async () => {setBusy(true); try {const {scorePdf}=await import('./pdf'); await scorePdf(title,tempo); setStatus('PDF 다운로드 완료.');} catch(e) {setStatus(`PDF 생성 실패: ${e.message}`);} finally {setBusy(false);}}} disabled={locked || !notes.length}>PDF 다운로드</button>
      <button onClick={() => window.print()} disabled={locked || !notes.length}>인쇄</button>
      <button onClick={() => download('soriscore.musicxml',musicXml(notes,title,tempo),'application/vnd.recordare.musicxml+xml')} disabled={locked || !notes.length}>MusicXML 저장</button>
      <button onClick={() => download('soriscore.json',JSON.stringify({version:1,...project},null,2),'application/json')} disabled={locked}>프로젝트 저장</button>
      <label className={`upload ${locked ? 'disabled' : ''}`}>프로젝트 불러오기<input aria-label="프로젝트 불러오기" type="file" accept=".json" disabled={locked} onChange={event => { importProject(event.target.files[0]); event.target.value = ''; }}/></label>
    </div></div>
      {storageError && <p role="alert">자동 저장을 사용할 수 없습니다. 프로젝트 저장 버튼으로 파일을 내려받으세요.</p>}
      <div className="fields"><label>곡 제목<input maxLength={100} value={title} disabled={locked} onChange={event => setProject(previous => ({...previous,title:event.target.value}))}/></label>
        <label>속도 (BPM)<input type="number" min="40" max="240" value={tempo} disabled={locked || playing} onChange={event => setProject(previous => ({...previous,tempo:Math.max(40,Math.min(240,Number(event.target.value) || 120))}))}/></label></div>
      <div className="print-heading"><h2>{title || '나의 노래'}</h2><p>4/4 · ♩ = {tempo}</p></div>
      <Score notes={notes}/>
      {suggestedTempo && <p className="hint">추정 속도: {suggestedTempo} BPM (반·두 배 속도일 수 있습니다). <button disabled={locked || playing} onClick={() => {setProject(p => ({...p,tempo:suggestedTempo,notes:reduceFrames(lastFrames.current,suggestedTempo)})); setStatus('추정 속도로 원본 녹음을 다시 채보했습니다. 가사는 다시 배치해주세요.');}}>추정 속도로 다시 채보</button></p>}
      <fieldset disabled={locked}><div className="lyric"><input aria-label="일괄 가사" value={lyrics} onChange={event => setLyrics(event.target.value)} placeholder="가사 입력 (공백으로 나누거나 한 글자씩 배치)"/><button onClick={applyLyrics}>가사 음표에 배치</button></div>
        <p className="hint">4/4박자 · 1박 = 4분음표. 마지막 마디는 쉼표로 채웁니다. 녹음 전에 속도를 맞춰주세요. 박자 추정은 참고용이며 음표 길이를 직접 수정할 수 있습니다.</p>
        <p className="hint">자동 가사 인식은 제공하지 않습니다. 브라우저 음성 인식은 외부 서버를 사용할 수 있고 노래 인식도 불안정합니다. 아래에서 가사를 직접 입력·수정해주세요.</p>
        <div className="note-list">{notes.map((note,index) => <div className="note" key={index}><span>{index + 1}</span>
          <select aria-label={`${index + 1}번 음정`} value={note.m === null ? 'rest' : note.m} onChange={event => edit(index,{m:event.target.value === 'rest' ? null : Number(event.target.value)})}><option value="rest">쉼표</option>{Array.from({length:61},(_,offset) => offset + 36).map(midi => <option key={midi} value={midi}>{noteName(midi)}</option>)}</select>
          <input aria-label={`${index + 1}번 가사`} maxLength={80} value={note.l} placeholder="가사" disabled={note.m === null} onChange={event => edit(index,{l:event.target.value})}/>
          <select aria-label={`${index + 1}번 길이`} value={note.d} onChange={event => edit(index,{d:Number(event.target.value)})}>{Array.from(new Set([.25,.5,1,2,4,note.d])).sort((first,second) => first - second).map(duration => <option key={duration} value={duration}>{duration}박</option>)}</select>
          <button aria-label={`${index + 1}번 음표 삭제`} onClick={() => setNotes(previous => previous.filter((_,current) => current !== index))}>×</button>
        </div>)}</div>
        <div className="actions footer-actions"><button disabled={notes.length >= MAX_NOTES} onClick={() => setNotes(previous => [...previous,{m:60,d:1,l:''}])}>+ 음표 추가</button><button disabled={notes.length >= MAX_NOTES} onClick={() => setNotes(previous => [...previous,{m:null,d:1,l:''}])}>+ 쉼표 추가</button><button onClick={() => { if (confirm('예시 악보로 초기화할까요?')) { stopPlayback(); setNotes(SAMPLE); } }}>예시로 초기화</button></div>
      </fieldset>
    </section>
    <footer>소리악보 1.0 · 음성은 기기 안에서만 분석되며 서버에 전송되지 않습니다.<br/>반주 없는 단선율 전용 · 한국어 가사 수동 입력 · 자동 채보 결과는 직접 확인하고 수정해주세요.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
