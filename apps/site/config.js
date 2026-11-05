// The Hydra API this page talks to. Set API_DEFAULT at deploy time. `?api=` overrides it only
// for a local API, so a crafted link cannot point visitors of the deployed site at another server.
const API_DEFAULT = 'https://hydra-api-5xmn.onrender.com'

const override = new URLSearchParams(location.search).get('api')
const local = (u) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(u).hostname)
  } catch {
    return false
  }
}

export const API_URL = (override && local(override) ? override : API_DEFAULT).replace(/\/+$/, '')
