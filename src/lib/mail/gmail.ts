import { loadScript } from './loadScript'
import { rfc2822, toBase64Url } from './message'
import type { MailSender, OutgoingMessage } from './index'

/**
 * Sending from the organizer's own Gmail, straight from the browser.
 *
 * There is no server here — the free plan has no Cloud Functions — so instead of a
 * transactional service the page asks Google for a short-lived token scoped to
 * `gmail.send` and posts each message itself. The client id is public, which is how OAuth
 * public clients work: what protects the account is the consent screen and the origin
 * allowlist, not a secret in the bundle.
 *
 * `gmail.send` cannot read anything. It is send-only, which is the whole of what this
 * needs and the least that will do it.
 *
 * Setup, once, in the Google Cloud console for the existing Firebase project: enable the
 * Gmail API, create an OAuth Web client with the hosting origin as an authorized JavaScript
 * origin, and keep the consent screen in Testing with each organizer added as a test user.
 * `gmail.send` is a restricted scope, so publishing it externally would mean a security
 * assessment; Testing needs none, and tokens here are per-session so the seven-day refresh
 * expiry never applies.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client'
/*
  Send-only, plus enough to name the mailbox.

  `gmail.send` cannot read anything — it is the least that will do the job. `openid email`
  is added so the screen can say which account is about to send: an organizer with a
  personal and a Scouts Google account can easily grant the wrong one, and eighteen emails
  from the wrong address is not something to find out about afterwards.
*/
const SCOPE = 'openid email https://www.googleapis.com/auth/gmail.send'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

interface TokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}

interface GoogleGsi {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        callback: (response: TokenResponse) => void
        error_callback?: (error: { type?: string; message?: string }) => void
      }) => TokenClient
    }
  }
}

/** Held for the session only. Nothing is persisted — a token in storage is a token to steal. */
let token = ''
let account = ''

export function gmailSender(clientId: string): MailSender {
  return {
    channel: 'gmail',
    label: 'Gmail',
    isConnected: () => token !== '',
    sendingAs: () => account,

    connect: async () => {
      if (!clientId) {
        throw new Error(
          'No Google client id is configured, so this app cannot ask for permission to send. ' +
            'Set VITE_GOOGLE_CLIENT_ID.',
        )
      }
      await loadScript(GSI_SRC, 'Google sign-in')

      const google = (globalThis as { google?: GoogleGsi }).google
      if (!google) throw new Error('Google sign-in did not load.')

      token = await new Promise<string>((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: (response) => {
            if (response.access_token) resolve(response.access_token)
            else {
              reject(
                new Error(
                  response.error_description ??
                    response.error ??
                    'Permission to send mail was not granted.',
                ),
              )
            }
          },
          error_callback: (error) => {
            reject(new Error(error.message ?? 'Permission to send mail was not granted.'))
          },
        })
        client.requestAccessToken()
      })

      account = await whoGranted(token)
    },

    send: async (message: OutgoingMessage) => {
      if (!token) throw new Error('Not connected to Gmail.')

      const response = await fetch(SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: toBase64Url(rfc2822(message)) }),
      })

      if (!response.ok) {
        /*
          A dead token mid-run is the one worth naming.

          It is the difference between "this address is wrong" and "stop, reconnect, and
          the rest have not gone" — and an organizer reading a list of failures needs to
          know which.
        */
        if (response.status === 401 || response.status === 403) {
          token = ''
          throw new Error('Gmail refused the token. Connect again and send the rest.')
        }
        if (response.status === 429) {
          throw new Error('Gmail is rate-limiting. Wait a minute and send the rest.')
        }
        throw new Error(`Gmail said ${response.status}: ${await readError(response)}`)
      }
    },
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    return body.error?.message ?? response.statusText
  } catch {
    return response.statusText
  }
}

/**
 * Which mailbox granted permission.
 *
 * Best-effort: if this fails the send still works, and the screen just cannot name the
 * account. Refusing to send because a label could not be fetched would be the wrong trade.
 */
async function whoGranted(accessToken: string): Promise<string> {
  try {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return ''
    const body = (await response.json()) as { email?: string }
    return body.email ?? ''
  } catch {
    return ''
  }
}

/** For sign-out, and for tests: forget the token without reloading the page. */
export function forgetGmailToken(): void {
  token = ''
  account = ''
}
