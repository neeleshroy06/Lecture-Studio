/** Optional PHI/PII-style redaction before sending extracted text to the model. */

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_RE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){1,2}\d{4}\b/g
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g
const MRN_LIKE_RE = /\b(?:MRN|medical record)\s*[#:]?\s*[\w-]+\b/gi

export function redactPhiLikeText(input) {
  if (!input) return ''
  let text = input
  text = text.replace(EMAIL_RE, '[redacted-email]')
  text = text.replace(PHONE_RE, '[redacted-phone]')
  text = text.replace(SSN_RE, '[redacted-id]')
  text = text.replace(MRN_LIKE_RE, '[redacted-record]')
  return text
}
