import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {detectPitch,hzMidi,midiFreq,reduceFrames,estimateTempo,measuresFor,validateProject,musicXml} from './src/music.js';
let checks = 0;
for (const bpm of [60,90,120,150]) {
  const beatFrames = Array.from({length:110},(_,i) => ({t:i*.085,hz:midiFreq(60+Math.floor(i*.085*bpm/60)%4)}));
  assert.equal(estimateTempo(beatFrames,bpm),bpm); checks++;
}
assert.equal(estimateTempo([]),null); checks++;
for (const sampleRate of [22050,44100,48000]) {
  for (const midi of [36,48,60,61,69,72,84]) {
    const frequency = midiFreq(midi);
    const signal = Float32Array.from({length:4096},(_,index) => .3 * Math.sin(2 * Math.PI * frequency * index / sampleRate));
    assert.equal(hzMidi(detectPitch(signal,sampleRate)),midi,`${sampleRate}Hz MIDI ${midi}`);
    checks++;
  }
}
assert.equal(detectPitch(new Float32Array(4096),48000),null); checks++;
const frames = [];
for (let index = 0; index < 36; index++) frames.push({t:index * .085,hz:index < 3 || index >= 33 ? null : index < 13 ? midiFreq(60) : index < 23 ? midiFreq(61) : midiFreq(62)});
assert.deepEqual(reduceFrames(frames).map(note => note.m),[60,61,62]); checks++;
assert.notEqual(reduceFrames(frames,60)[0].d,reduceFrames(frames,120)[0].d); checks++;
const restFrames = Array.from({length:30},(_,index) => ({t:index*.085,hz:index < 10 ? 440 : index < 15 ? null : 493.88}));
assert.deepEqual(reduceFrames(restFrames).map(note => note.m),[69,null,71]); checks++;
const notes = [{m:60,d:3,l:'안'},{m:61,d:2,l:'녕'},{m:null,d:.5,l:''},{m:64,d:.25,l:'해'}];
const measures = measuresFor(notes);
assert.ok(measures.every(measure => measure.reduce((sum,note) => sum + note.ticks,0) === 16)); checks++;
assert.ok(measures.flat().some(note => note.tieStart)); checks++;
assert.ok(measures.flat().some(note => note.tieStop)); checks++;
assert.equal(measures.flat().filter(note => !note.padding).reduce((sum,note) => sum + note.ticks,0),23); checks++;
for (const invalid of [{notes:[{m:200,d:1}]},{notes:[{m:60,d:-1}]},{notes:[{m:60,d:.3}]},{notes:[null]},{notes:'bad'}]) {
  assert.throws(() => validateProject(invalid)); checks++;
}
assert.deepEqual(validateProject({title:'검증',notes,tempo:90}).notes,notes); checks++;
const xml = musicXml(notes,'제목 & <검증>',90);
assert.ok(xml.includes('제목 &amp; &lt;검증&gt;') && xml.includes('<type>16th</type>') && xml.includes('<rest/>')); checks++;
await writeFile(new URL('./verification.musicxml',import.meta.url),xml);
const sampleRate = 44100,seconds = 3;
const wav = Buffer.alloc(44 + sampleRate * seconds * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(sampleRate,24); wav.writeUInt32LE(sampleRate*2,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
for (let index = 0; index < sampleRate * seconds; index++) {
  const segment = Math.floor(index/sampleRate),localTime = index/sampleRate - segment;
  const frequency = midiFreq([60,61,64][segment]);
  const envelope = Math.min(1,localTime/.03,(1-localTime)/.03);
  wav.writeInt16LE(Math.round(.35 * envelope * Math.sin(2*Math.PI*frequency*localTime)*32767),44+index*2);
}
await writeFile(new URL('./melody-C4-Cs4-E4.wav',import.meta.url),wav);
await writeFile(new URL('./invalid-project.json',import.meta.url),JSON.stringify({notes:[{m:999,d:-5}]}));
await writeFile(new URL('./rhythm-project.json',import.meta.url),JSON.stringify({title:'리듬 검증 악보',notes,tempo:90}));
console.log(`${checks} assertions passed; WAV and rhythm fixtures generated.`);

