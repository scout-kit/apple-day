import { loadScript } from './mail/loadScript'
import type { FormQuestion, FormSpec } from '../domain/signupForm'

/**
 * Building the signup form in Google Forms, from the browser.
 *
 * The same arrangement as sending mail, for the same reason: there is no server, so the
 * page asks Google for a short-lived token and calls the API itself. The form is created in
 * the signed-in organizer's own Drive, which is where it belongs — this app never sees the
 * responses and does not want to.
 *
 * `forms.body` writes forms and reads nothing else. It cannot see a response, a Drive file,
 * or anything else on the account.
 *
 * Setup, once, in the Google Cloud console for the existing Firebase project: enable the
 * Google Forms API and add this scope to the OAuth client already made for Gmail.
 * Organizers accept the extra permission the next time they use this.
 *
 * Nothing here is required. The same form can be built by hand from `describeSpec`, and the
 * screen offers that whether or not any of this is configured — a group should not have to
 * touch Google Cloud to run an Apple Day.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client'
const SCOPE = 'https://www.googleapis.com/auth/forms.body'
const CREATE_URL = 'https://forms.googleapis.com/v1/forms'

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

/** Held for the session only. A token in storage is a token to steal. */
let token = ''

export interface CreatedForm {
  formId: string
  /** Where to send families. */
  responderUri: string
  /** Where the organizer edits it and reads the responses. */
  editUri: string
}

/**
 * Ask for permission to create a form.
 *
 * Separate from creating one so the consent popup opens while somebody is looking at a
 * button they pressed, rather than in the middle of the work — a popup blocker mid-run
 * strands it half done.
 */
export async function connect(clientId: string): Promise<void> {
  if (!clientId) {
    throw new Error(
      'No Google client id is configured, so this app cannot ask for permission to build a ' +
        'form. Set VITE_GOOGLE_CLIENT_ID, or build it by hand from the questions below.',
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
                'Permission to create a form was not granted.',
            ),
          )
        }
      },
      error_callback: (error) => {
        reject(new Error(error.message ?? 'Permission to create a form was not granted.'))
      },
    })
    client.requestAccessToken()
  })
}

export const isConnected = (): boolean => token !== ''

/**
 * One question, as the Forms API wants it.
 *
 * The shapes are Google's and the mapping is the whole of this function, which is why it is
 * apart from the spec: `domain/signupForm` describes a form in the app's own terms and knows
 * nothing about `questionItem` or `choiceQuestion`.
 */
function toItem(question: FormQuestion): Record<string, unknown> {
  const ask: Record<string, unknown> = { required: question.required }

  if (question.kind === 'text' || question.kind === 'longText') {
    ask.textQuestion = { paragraph: question.kind === 'longText' }
  } else {
    ask.choiceQuestion = {
      type: question.kind === 'checkboxes' ? 'CHECKBOX' : 'RADIO',
      options: (question.options ?? []).map((value) => ({ value })),
      /*
        Never shuffled. The options are shift times in order, and a family reading them
        shuffled has to sort the evening out in their head before they can tick anything.
      */
      shuffle: false,
    }
  }

  return {
    title: question.title,
    ...(question.help ? { description: question.help } : {}),
    questionItem: { question: ask },
  }
}

/**
 * Create the form and fill it in.
 *
 * Two calls, because that is what the API allows: `create` takes a title and nothing else,
 * and everything after it — the description and every question — arrives as a batch of
 * edits. The batch is one request, so the form is never half-built for longer than it takes
 * to answer.
 */
export async function createForm(spec: FormSpec): Promise<CreatedForm> {
  if (!token) throw new Error('Not connected to Google Forms.')

  const created = await call<{ formId?: string; responderUri?: string }>(CREATE_URL, {
    info: { title: spec.title, documentTitle: spec.title },
  })

  const formId = created.formId
  if (!formId) throw new Error('Google created a form but did not say which.')

  await call(`${CREATE_URL}/${formId}:batchUpdate`, {
    requests: [
      {
        updateFormInfo: {
          info: { description: spec.description },
          updateMask: 'description',
        },
      },
      // Indexed explicitly, so the order is the one the spec chose rather than the order
      // the requests happen to be applied in.
      ...spec.questions.map((question, index) => ({
        createItem: { item: toItem(question), location: { index } },
      })),
    ],
  })

  return {
    formId,
    responderUri: created.responderUri ?? `https://docs.google.com/forms/d/${formId}/viewform`,
    editUri: `https://docs.google.com/forms/d/${formId}/edit`,
  }
}

async function call<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    /*
      Named rather than numbered, because each of these needs something different doing.

      A refused token is "press it again"; a missing API is somebody's job in the Cloud
      console; anything else is Google's own message, which is more use than a status code.
    */
    if (response.status === 401 || response.status === 403) {
      token = ''
      const detail = await readError(response)
      throw new Error(
        /disabled|not been used|enable/i.test(detail)
          ? 'The Google Forms API is not enabled on this project yet. Enable it in the ' +
            'Google Cloud console, then try again.'
          : 'Google refused the permission. Try again, and check this account is a test ' +
            'user on the consent screen.',
      )
    }
    throw new Error(`Google Forms said ${response.status}: ${await readError(response)}`)
  }

  return (await response.json()) as T
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    return body.error?.message ?? response.statusText
  } catch {
    return response.statusText
  }
}
