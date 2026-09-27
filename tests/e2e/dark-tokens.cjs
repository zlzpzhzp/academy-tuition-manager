const declarations = block => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
function tokenSets(css) {
  const root = declarations(css.split(':root {')[1].split('\n}')[0])
  const light = { ...root, ...declarations(css.split(':root:has([data-ui-theme="paper"]) {')[1].split('\n}')[0]) }
  const dark = { ...light, ...declarations(css.split(':root:has([data-ui-theme="paper"])[data-paper-scheme="dark"]')[1].split('\n}')[0]) }
  return { light, dark }
}
function resolve(tokens, value, seen = []) {
  if (value.startsWith('--')) {
    if (seen.includes(value) || !(value in tokens)) throw Error(`토큰 해석 실패: ${value}`)
    return resolve(tokens, tokens[value], [...seen, value])
  }
  return value.replace(/var\((--[\w-]+)\)/g, (_, key) => resolve(tokens, key, seen))
}
const rgb = hex => hex.slice(1).match(/../g).map(c => parseInt(c, 16))
const luminance = rgb => rgb.reduce((sum, c, i) => sum + (c / 255 <= .04045 ? c / 255 / 12.92 : ((c / 255 + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i], 0)
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
function contrast(tokens, fg, bg, opacity = 1) {
  const back = rgb(resolve(tokens, bg)), front = rgb(resolve(tokens, fg)).map((c, i) => c * opacity + back[i] * (1 - opacity))
  const alpha = Number(tokens['--paper-grain-opacity']) * Number(tokens['--paper-grain'].match(/slope='([.\d]+)'/)[1])
  const extremes = c => [0, 255].map(g => c.map(x => x * (1 - alpha) + g * alpha))
  return Math.min(...extremes(front).flatMap(a => extremes(back).map(b => ratio(a, b))))
}
const pairs = []
for (const bg of ['--bg','--bg-card','--bg-card-hover','--bg-elevated']) for (const fg of ['--text-1','--text-2','--text-3','--text-4']) pairs.push([fg,bg])
for (const color of ['blue','red','green','purple','pink','cyan','yellow']) pairs.push([`--${color}`,`--${color}-dim`])
for (const status of ['paid','unpaid','scheduled']) pairs.push([`--${status}-text`,`--${status}-bg`])
pairs.push(['--scheduled-text','--orange-dim'],['--blue','--blue-bg'],['--red','--blue-dim'])
for (const bg of ['--blue','--blue-hover','--red','--red-hover','--green','--orange','--unpaid-text']) pairs.push(['--on-action',bg])
for (const [fg,bg] of [['--foreground','--background'],['--text-primary','--surface'],['--text-secondary','--surface-2'],['--text-tertiary','--surface-3']]) pairs.push([fg,bg])
module.exports = { declarations, tokenSets, resolve, contrast, pairs, rgb, luminance, ratio }
