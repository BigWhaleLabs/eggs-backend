import { Resvg } from '@resvg/resvg-js'
import { readFileSync } from 'fs'
import { cwd } from 'process'
import type { ReactNode } from 'react'
import satori from 'satori'
import sharp from 'sharp'
import emojiForText from './emojiForText'

type FontStyle = 'normal' | 'italic'

const macintosh128K = readFileSync(
  `${cwd()}/src/og/assets/fonts/Macintosh128K.ttf`,
)

const fonts = [
  {
    data: macintosh128K,
    name: 'Macintosh128K',
    style: 'normal' as FontStyle,
  },
]

export default async function getSvgStream(
  element: ReactNode,
  width: number,
  height: number,
) {
  const svg = await satori(element, {
    debug: false,
    fonts,
    height,
    loadAdditionalAsset: async (code, text) => {
      if (code === 'emoji') {
        try {
          return await emojiForText(text)
        } catch (error) {
          console.error(
            `Error loading emoji: "${text}"`,
            error instanceof Error ? error.message : error,
          )
          return code
        }
      }
      return code
    },
    width,
  })
  const resvgJS = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: width,
    },
  })
  const result = resvgJS.render().asPng()
  const jpgBuffer = await sharp(result).jpeg({ quality: 90 }).toBuffer()

  return new ReadableStream({
    start(controller) {
      controller.enqueue(jpgBuffer)
      controller.close()
    },
  })
}
