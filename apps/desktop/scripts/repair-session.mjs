// 修复脚本：删除会话日志中因"中断 + resume 闭包重复合成"产生的 seq 回退行。
// 算法：顺序扫描解压后的行；某行 seq 小于期望值时视为重复块跳过，直到 seq
// 重新连续；最后重压为 zstd 多帧写回（默认输出 .repaired，不修改原文件）。
//
// 用法：node repair-session.mjs <input.jsonl.zstd> <output.jsonl.zstd>
// 注意：必须在持有该会话的宿主（dsh web / 桌面版）停止后执行。
import { scanZstdFrames } from '../../packages/session/session-persistence-jsonl/lib/types/zstd.js'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error('usage: node repair-session.mjs <input.jsonl.zstd> <output.jsonl.zstd>')
  process.exit(2)
}

const buf = readFileSync(input)
const { frames, tornStart } = scanZstdFrames(buf)
console.log('frames:', frames.length, 'tornStart:', tornStart)
const parts = []
for (const f of frames) {
  try {
    parts.push(zstdDecompressSync(buf.subarray(f.start, f.end)))
  } catch (e) {
    console.error('frame decode fail at', f.start, e.message)
  }
}
const lines = Buffer.concat(parts).toString('utf8').split('\n')

let expected = -1
let dropped = 0
const kept = []
for (const line of lines) {
  if (line.trim() === '') continue
  let seq
  try {
    const obj = JSON.parse(line)
    seq = typeof obj.seq === 'number' ? obj.seq : (typeof obj.seq0 === 'number' ? obj.seq0 : undefined)
  } catch {
    seq = undefined
  }
  if (seq === undefined) {
    kept.push(line) // header 或非事件行：保留，不影响连续性
    continue
  }
  if (expected < 0) expected = seq
  if (seq < expected) {
    dropped++
    continue
  }
  expected = seq + 1
  kept.push(line)
}
console.log('kept lines:', kept.length, 'dropped:', dropped, 'max seq:', expected - 1)

const FRAME_LINES = 2000
const chunks = []
for (let i = 0; i < kept.length; i += FRAME_LINES) {
  chunks.push(Buffer.from(kept.slice(i, i + FRAME_LINES).join('\n') + '\n', 'utf8'))
}
const out = Buffer.concat(chunks.map((c) => zstdCompressSync(c, { level: 3 })))
writeFileSync(output, out)
console.log('wrote', output, out.length, 'bytes,', chunks.length, 'frames')
