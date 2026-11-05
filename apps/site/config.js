// The Hydra API this page talks to. Set API_DEFAULT at deploy time; `?api=` overrides it for testing.
const API_DEFAULT = 'http://localhost:8787'

export const API_URL = (new URLSearchParams(location.search).get('api') ?? API_DEFAULT).replace(/\/+$/, '')
