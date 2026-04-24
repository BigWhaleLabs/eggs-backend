export default async function isFetchable(
  imageUrl?: string | null | undefined,
) {
  if (!imageUrl) {
    return false
  }
  let canBeFetched = false
  try {
    canBeFetched = imageUrl
      ? await fetch(imageUrl)
          .then((res) => {
            if (!res.ok) {
              throw new Error(`Failed to fetch the image: ${imageUrl}`)
            }
            return res
          })
          .then((res) => res.blob())
          .then((b) => b.size > 0)
      : false
  } catch (e) {
    console.error('Error fetching image', e)
  }
  return canBeFetched
}
