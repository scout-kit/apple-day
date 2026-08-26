/**
 * Pull in a provider's sign-in library, once, when it is first needed.
 *
 * On demand rather than from `index.html`: most people never open the reminder screen, and
 * hosting transfer is the one free-plan quota worth watching. Both libraries are loaded the
 * same way so there is one place to look when a content-security policy blocks one of them
 * — which is the failure mode here, and it only shows up once deployed.
 */

const loading = new Map<string, Promise<void>>()

export function loadScript(src: string, friendlyName: string): Promise<void> {
  const already = loading.get(src)
  if (already) return already

  const started = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing?.dataset.loaded === 'true') {
      resolve()
      return
    }

    const tag = existing ?? document.createElement('script')
    tag.src = src
    tag.async = true
    tag.addEventListener('load', () => {
      tag.dataset.loaded = 'true'
      resolve()
    })
    tag.addEventListener('error', () => {
      // Forgotten, so pressing the button again tries again rather than failing for ever
      // on a promise that settled during a dropped connection.
      loading.delete(src)
      tag.remove()
      reject(
        new Error(
          `Could not load ${friendlyName}. Check the connection, and that the page's ` +
            'content-security policy allows it.',
        ),
      )
    })
    if (!existing) document.head.appendChild(tag)
  })

  loading.set(src, started)
  return started
}

