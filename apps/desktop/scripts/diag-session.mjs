// 诊断脚本：解压 zstd 多帧会话日志，查找 seq 回退与乱序点（seq 链完整性检查）。
// 用法：node diag-session.mjs <session.jsonl.zstd>
import { scanZstdFrames } from '../../packages/session/session-persistence-jsonl/lib/types/zstd.js'
import { zstdDecompressSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

const p = process.argv[2]
const buf = readFileSync(p)
const { frames, tornStart } = scanZstdFrames(buf)
console.log('frames:', frames.length, 'tornStart:', tornStart, 'fileSize:', buf.length)

const parts = []
for (let i = 0; i < frames.length; i++) {
  const f = frames[i]
  try {
    parts.push(zstdDecompressSync(buf.subarray(f.start, f.end)))
  } catch (e) {
    console.log('frame', i, 'decode FAIL at', f.start, ':', e.message)
  }
}
const text = Buffer.concat(parts).toString('utf8')
const lines = text.split('\n')
console.log('total lines:', lines.length)

// 找 seq 回退（negative gap）——这是读取器报"seq gap in committed region"的形状
let prev = -1
let issues = 0
for (let i = 0; i < lines.length; i++) {
  let seq
  try {
    const obj = JSON.parse(lines[i])
    seq = typeof obj.seq === 'number' ? obj.seq : obj.seq0
  } catch {
    continue
  }
  if (typeof seq !== 'number') continue
  if (seq < prev) {
    console.log('BACKWARD at line', i + 1, ': prev seq', prev, '->', seq)
    console.log('  line text:', lines[i].slice(0, 200))
    issues++
    if (issues >= 10) break
  }
  prev = seq
}
console.log('backward jumps found:', issues, '| max seq seen:', prev)
