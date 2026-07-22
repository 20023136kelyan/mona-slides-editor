export function isMobileUserAgent(userAgent = navigator.userAgent) {
  return /(iPhone|iPod|iPad|Android|Mobile|BlackBerry|Symbian|Windows Phone)/i.test(userAgent)
}
