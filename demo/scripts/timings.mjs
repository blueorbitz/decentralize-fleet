// Read the duration of every voiceover file and retime the beats.
//
// The voiceover is the timing source of truth: a beat's length is its audio
// length plus a short tail, so a cut never lands mid-sentence and the picture
// follows the voice rather than the other way round.
//
// Duration is computed from the MPEG frame headers rather than decoded, because
// the only ffmpeg on this machine (Playwright's) is built with
// --disable-everything and cannot read MP3. Frame counting is exact for CBR and
// within a frame or two for VBR, which is far below one video frame.
//
//   node scripts/timings.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const voiceDir = path.join(root, 'public', 'voiceover');
const beatsFile = path.join(root, 'beats.json');

// MPEG audio bitrates (kbps) and sample rates, indexed the way the header stores
// them. Layer III only: every TTS export here is MP3.
const BITRATES = {
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };

// Walk the frames; each one is 1152 samples for Layer III.
export function mp3DurationSeconds(buffer) {
  let offset = 0;
  // Skip an ID3v2 tag if present.
  if (buffer.slice(0, 3).toString('latin1') === 'ID3') {
    const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    offset = 10 + size;
  }

  let frames = 0;
  let samples = 0;
  let sampleRate = 0;

  while (offset + 4 <= buffer.length) {
    const b1 = buffer[offset + 1];
    const b2 = buffer[offset + 2];
    // Frame sync: 11 set bits.
    if (buffer[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const versionBits = (b1 >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layerBits = (b1 >> 1) & 0x03; // 1 = Layer III
    if (layerBits !== 1 || versionBits === 1) {
      offset += 1;
      continue;
    }
    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 25;
    const bitrateIndex = (b2 >> 4) & 0x0f;
    const rateIndex = (b2 >> 2) & 0x03;
    if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
      offset += 1;
      continue;
    }
    const table = version === 1 ? BITRATES['1-3'] : BITRATES['2-3'];
    const bitrate = table[bitrateIndex] * 1000;
    const rate = SAMPLE_RATES[version][rateIndex];
    const padding = (b2 >> 1) & 0x01;
    const frameLength = version === 1
      ? Math.floor((144 * bitrate) / rate) + padding
      : Math.floor((72 * bitrate) / rate) + padding;

    frames += 1;
    samples += 1152;
    sampleRate = rate;
    offset += Math.max(frameLength, 4);
  }

  if (frames === 0 || sampleRate === 0) throw new Error('no MPEG frames found');
  return samples / sampleRate;
}

// A short tail so the next beat does not start on the last syllable.
function tailFor(seconds) {
  if (seconds < 10) return 0.4;
  if (seconds < 25) return 0.6;
  return 0.8;
}

function main() {
  const beats = JSON.parse(fs.readFileSync(beatsFile, 'utf8'));
  const rows = [];
  let total = 0;

  for (const beat of beats.beats) {
    const file = path.join(voiceDir, `${beat.id}.mp3`);
    if (!fs.existsSync(file)) {
      rows.push({ id: beat.id, missing: true });
      continue;
    }
    const audio = mp3DurationSeconds(fs.readFileSync(file));
    const seconds = Math.round((audio + tailFor(audio)) * 100) / 100;
    total += seconds;
    rows.push({ id: beat.id, audio, seconds, was: beat.seconds, delta: seconds - beat.seconds });
    beat.seconds = seconds;
    beat.voiceover = `voiceover/${beat.id}.mp3`;
    beat.audioSeconds = Math.round(audio * 100) / 100;
  }

  fs.writeFileSync(beatsFile, `${JSON.stringify(beats, null, 2)}\n`);

  console.log('beat    audio     beat    (was)     delta');
  for (const r of rows) {
    if (r.missing) {
      console.log(`${r.id}    MISSING`);
      continue;
    }
    const sign = r.delta >= 0 ? '+' : '';
    console.log(
      `${r.id}  ${r.audio.toFixed(2).padStart(6)}s ${r.seconds.toFixed(2).padStart(7)}s  (${String(r.was).padStart(5)}s)  ${sign}${r.delta.toFixed(2)}s`,
    );
  }
  console.log(`\ntotal ${total.toFixed(1)}s  (${Math.floor(total / 60)}m${Math.round(total % 60)}s)`);
  console.log(`frames ${Math.round(total * beats.fps)} at ${beats.fps}fps`);
}

main();
