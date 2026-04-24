const U200D = String.fromCharCode(8205)
const UFE0Fg = /\uFE0F/g

function toCodePoint(unicodeSurrogates: string) {
  const r = []
  let c = 0,
    p = 0,
    i = 0
  while (i < unicodeSurrogates.length) {
    c = unicodeSurrogates.charCodeAt(i++)
    if (p) {
      r.push((65536 + ((p - 55296) << 10) + (c - 56320)).toString(16))
      p = 0
    } else if (55296 <= c && c <= 56319) {
      p = c
    } else {
      r.push(c.toString(16))
    }
  }
  return r.join('-')
}
function getIconCode(char: string) {
  return toCodePoint(!char.includes(U200D) ? char.replace(UFE0Fg, '') : char)
}
function loadEmoji(code: string) {
  const api = (code: string) =>
    'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/' +
    code.toLowerCase() +
    '.svg'
  return fetch(api(code))
}

export default async function emojiForText(text: string) {
  return (
    `data:image/svg+xml;base64,` +
    btoa(await (await loadEmoji(getIconCode(text))).text())
  )
}
