import { apiUrl } from './apiUrl'

export function apiRequestUrl(path) {
  return apiUrl(path)
}

export function getApiErrorMessage(error, { action = 'complete the request', fallback = 'Request failed.' } = {}) {
  const status = error?.response?.status
  const upstreamMessage = error?.response?.data?.message

  if (typeof upstreamMessage === 'string' && upstreamMessage.trim()) {
    return upstreamMessage.trim()
  }

  if (status === 404) {
    return `Could not ${action} because the API route was not found (404). Make sure the Express proxy is running and that the app is connected to the same backend.`
  }

  if (status >= 500) {
    return `Could not ${action} because the backend returned an error (${status}). Check the proxy logs and API keys, then try again.`
  }

  if (error?.request && !error?.response) {
    return `Could not ${action} because the backend did not respond. Make sure the Express proxy is running and reachable.`
  }

  return error?.message || fallback
}
